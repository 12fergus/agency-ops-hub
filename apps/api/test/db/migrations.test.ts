import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/client.js';
import { backupDatabase } from '../../src/db/backup.js';
import {
  MIGRATIONS_DIR,
  MigrationDriftError,
  getMigrationStatus,
  runMigrations,
} from '../../src/db/migrator.js';
import { isNetworkPath, loadConfig } from '../../src/lib/config.js';
import { tempDir } from '../helpers/db.js';

const EXPECTED_TABLES = [
  'audit_events',
  'campaigns',
  'client_communications',
  'client_contacts',
  'client_members',
  'client_statuses',
  'clients',
  'lead_activities',
  'lead_import_batches',
  'leads',
  'pipeline_stages',
  'pipelines',
  'sessions',
  'tasks',
  'users',
];

const EXPECTED_INDEXES = [
  'leads_client_created_idx',
  'leads_client_stage_idx',
  'leads_client_assignee_idx',
  'leads_client_phone_idx',
  'leads_client_email_idx',
  'leads_source_external_unique',
  'tasks_assignee_status_due_idx',
  'tasks_client_status_due_idx',
  'lead_activities_lead_occurred_idx',
  'users_email_unique',
  'sessions_token_hash_unique',
  'pipelines_one_default',
  'client_contacts_one_primary',
  'campaigns_external_unique',
  'pipeline_stages_position_unique',
  'audit_events_client_created_idx',
];

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

describe('migrations', () => {
  it('fresh migration creates every table on a new file DB with WAL + FKs', () => {
    const t = tempDir();
    cleanup = t.cleanup;
    const handle = openDatabase(path.join(t.dir, 'fresh.sqlite'));
    try {
      expect(getMigrationStatus(handle).applied).toBe(0);
      const status = runMigrations(handle);
      expect(status.pending).toEqual([]);
      expect(status.applied).toBe(status.available);
      expect(status.applied).toBeGreaterThan(0);

      const tables = handle.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations' ORDER BY name",
        )
        .pluck()
        .all();
      expect(tables).toEqual(EXPECTED_TABLES);
      expect(handle.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(handle.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(handle.sqlite.pragma('busy_timeout', { simple: true })).toBe(5000);
    } finally {
      handle.close();
    }
  });

  it('is repeatable: re-running (same and new connection) applies nothing and keeps data', () => {
    const t = tempDir();
    cleanup = t.cleanup;
    const file = path.join(t.dir, 'repeat.sqlite');

    const first = openDatabase(file);
    const s1 = runMigrations(first);
    first.sqlite.prepare("INSERT INTO clients (id, name) VALUES ('c1', 'keep me')").run();
    const s2 = runMigrations(first);
    expect(s2.applied).toBe(s1.applied);
    first.close();

    const second = openDatabase(file);
    const s3 = runMigrations(second);
    expect(s3.applied).toBe(s1.applied);
    expect(second.sqlite.prepare('SELECT name FROM clients').pluck().get()).toBe('keep me');
    second.close();
  });

  it('creates the required indexes', () => {
    const handle = openDatabase(':memory:');
    runMigrations(handle);
    const names = new Set(
      handle.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='index'")
        .pluck()
        .all() as string[],
    );
    for (const idx of EXPECTED_INDEXES) expect(names, idx).toContain(idx);

    // The lead list query actually uses the composite index.
    const plan = handle.sqlite
      .prepare(
        "EXPLAIN QUERY PLAN SELECT * FROM leads WHERE client_id = 'x' ORDER BY created_at DESC LIMIT 50",
      )
      .all() as { detail: string }[];
    expect(plan.map((p) => p.detail).join(' ')).toContain('leads_client_created_idx');
    handle.close();
  });

  it('backup produces a verified, openable copy of a live WAL database', async () => {
    const t = tempDir();
    cleanup = t.cleanup;
    const handle = openDatabase(path.join(t.dir, 'live.sqlite'));
    runMigrations(handle);
    handle.sqlite.prepare("INSERT INTO clients (id, name) VALUES ('c1', 'backed up')").run();

    const file = await backupDatabase(handle.sqlite, path.join(t.dir, 'backups'), 'test');
    handle.close();
    expect(existsSync(file)).toBe(true);
    // Self-contained single file: no WAL/SHM siblings to forget when copying offsite.
    expect(existsSync(`${file}-wal`)).toBe(false);
    expect(existsSync(`${file}-shm`)).toBe(false);

    const copy = openDatabase(file);
    expect(copy.sqlite.prepare('SELECT name FROM clients').pluck().get()).toBe('backed up');
    expect(getMigrationStatus(copy).pending).toEqual([]);
    copy.close();
  });

  it('refuses network-share database paths', () => {
    expect(isNetworkPath('\\\\nas\\crm\\crm.sqlite')).toBe(true);
    expect(isNetworkPath('//nas/crm/crm.sqlite')).toBe(true);
    expect(isNetworkPath('C:\\crm\\crm.sqlite')).toBe(false);
    expect(isNetworkPath('data/crm.sqlite')).toBe(false);
    expect(() => loadConfig({ DATABASE_PATH: '\\\\nas\\crm\\crm.sqlite' })).toThrow(/local disk/);
  });

  it('detects drift: an applied migration edited afterwards', () => {
    const t = tempDir();
    cleanup = t.cleanup;
    const dir = path.join(t.dir, 'migrations');
    cpSync(MIGRATIONS_DIR, dir, { recursive: true });
    const handle = openDatabase(':memory:');
    runMigrations(handle, dir);

    const sqlFile = path.join(dir, '0000_init.sql');
    writeFileSync(sqlFile, `${readFileSync(sqlFile, 'utf8')}\n-- edited after apply\n`);
    expect(() => getMigrationStatus(handle, dir)).toThrow(MigrationDriftError);
    expect(() => runMigrations(handle, dir)).toThrow(MigrationDriftError);
    handle.close();
  });

  it('detects drift: an older migration merged after a newer one was applied', () => {
    const t = tempDir();
    cleanup = t.cleanup;
    const dir = path.join(t.dir, 'migrations');
    cpSync(MIGRATIONS_DIR, dir, { recursive: true });
    const handle = openDatabase(':memory:');
    runMigrations(handle, dir);

    // Simulate a branch migration whose timestamp is OLDER than the applied 0000_init.
    const journalFile = path.join(dir, 'meta/_journal.json');
    const journal = JSON.parse(readFileSync(journalFile, 'utf8'));
    const first = journal.entries[0];
    journal.entries.unshift({ ...first, idx: 0, when: first.when - 1000, tag: '0000_branch' });
    journal.entries.forEach((e: { idx: number }, i: number) => (e.idx = i));
    writeFileSync(journalFile, JSON.stringify(journal));
    writeFileSync(path.join(dir, '0000_branch.sql'), 'CREATE TABLE branch_only (id text);');

    // Plain drizzle would report "nothing to do" and silently never create branch_only.
    expect(() => runMigrations(handle, dir)).toThrow(MigrationDriftError);
    handle.close();
  });
});

describe('migration 0002 backfill (custom statuses)', () => {
  it('a paused client on 0001 becomes status מושהה + lifecycle active; others get פעיל', () => {
    const t = tempDir();
    const dir = path.join(t.dir, 'migrations');
    cpSync(MIGRATIONS_DIR, dir, { recursive: true });
    const journalFile = path.join(dir, 'meta/_journal.json');
    const full = readFileSync(journalFile, 'utf8');
    const journal = JSON.parse(full);
    // Pretend only 0000 + 0001 exist.
    writeFileSync(
      journalFile,
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, 2) }),
    );

    const handle = openDatabase(':memory:');
    try {
      runMigrations(handle, dir);
      handle.sqlite
        .prepare(
          "INSERT INTO clients (id, name, status) VALUES ('p', 'Paused one', 'paused'), ('a', 'Active one', 'active')",
        )
        .run();
      handle.sqlite
        .prepare(
          "INSERT INTO clients (id, name, status, archived_at) VALUES ('x', 'Archived one', 'archived', '2026-01-01T00:00:00.000Z')",
        )
        .run();

      writeFileSync(journalFile, full); // now 0002 arrives
      runMigrations(handle, dir);

      const rows = handle.sqlite
        .prepare(
          'SELECT c.id, c.status, s.name AS statusName FROM clients c JOIN client_statuses s ON s.id = c.status_id ORDER BY c.id',
        )
        .all();
      expect(rows).toEqual([
        { id: 'a', status: 'active', statusName: 'פעיל' },
        { id: 'p', status: 'active', statusName: 'מושהה' },
        { id: 'x', status: 'archived', statusName: 'פעיל' }, // lifecycle kept
      ]);
      expect(handle.sqlite.pragma('foreign_key_check')).toEqual([]);
    } finally {
      handle.close();
      t.cleanup();
    }
  });
});

describe('migration 0003 (communications + tasks rebuild)', () => {
  it('keeps existing tasks (new columns NULL) and then allows in_progress + links', () => {
    const t = tempDir();
    const dir = path.join(t.dir, 'migrations');
    cpSync(MIGRATIONS_DIR, dir, { recursive: true });
    const journalFile = path.join(dir, 'meta/_journal.json');
    const full = readFileSync(journalFile, 'utf8');
    const journal = JSON.parse(full);
    writeFileSync(
      journalFile,
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, 3) }),
    );

    const handle = openDatabase(':memory:');
    try {
      runMigrations(handle, dir); // up to 0002
      const s = handle.sqlite;
      s.prepare(
        "INSERT INTO users (id, email, display_name, password_hash, role) VALUES ('u', 'u@x.test', 'U', 'h', 'employee')",
      ).run();
      s.prepare("INSERT INTO clients (id, name) VALUES ('c', 'Client')").run();
      s.prepare(
        "INSERT INTO tasks (id, client_id, assigned_user_id, title, status, completed_at, due_at) VALUES ('t1', 'c', 'u', 'Open one', 'open', NULL, '2026-12-01T09:00:00.000Z'), ('t2', 'c', 'u', 'Done one', 'done', '2026-11-01T09:00:00.000Z', NULL)",
      ).run();

      writeFileSync(journalFile, full); // now 0003 arrives
      runMigrations(handle, dir);

      expect(
        s
          .prepare(
            'SELECT id, title, status, due_at, completed_at, created_by_user_id, communication_id FROM tasks ORDER BY id',
          )
          .all(),
      ).toEqual([
        {
          id: 't1',
          title: 'Open one',
          status: 'open',
          due_at: '2026-12-01T09:00:00.000Z',
          completed_at: null,
          created_by_user_id: null,
          communication_id: null,
        },
        {
          id: 't2',
          title: 'Done one',
          status: 'done',
          due_at: null,
          completed_at: '2026-11-01T09:00:00.000Z',
          created_by_user_id: null,
          communication_id: null,
        },
      ]);
      // New status + a same-client communication link work; a cross-client link is rejected.
      s.prepare(
        "INSERT INTO client_communications (id, client_id, author_user_id, type, occurred_at, summary) VALUES ('m', 'c', 'u', 'call', '2026-11-23T08:00:00.000Z', 'x')",
      ).run();
      s.prepare(
        "UPDATE tasks SET status = 'in_progress', communication_id = 'm' WHERE id = 't1'",
      ).run();
      s.prepare("INSERT INTO clients (id, name) VALUES ('c2', 'Other')").run();
      expect(() => s.prepare("UPDATE tasks SET client_id = 'c2' WHERE id = 't1'").run()).toThrow(
        /FOREIGN KEY/,
      );
      expect(s.pragma('foreign_key_check')).toEqual([]);
      // Indexes survived the rebuild.
      const idx = s
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tasks' AND name NOT LIKE 'sqlite_%'",
        )
        .all();
      expect(idx.map((r) => (r as { name: string }).name).sort()).toEqual([
        'tasks_assignee_status_due_idx',
        'tasks_client_status_due_idx',
        'tasks_communication_idx',
        'tasks_lead_idx',
      ]);
    } finally {
      handle.close();
      t.cleanup();
    }
  });
});
