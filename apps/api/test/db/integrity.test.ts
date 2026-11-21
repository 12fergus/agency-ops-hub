import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DbHandle } from '../../src/db/client.js';
import { createUser } from '../../src/db/repositories/users.js';
import { freshDb, twoClients } from '../helpers/db.js';

/**
 * Raw-SQL tests: prove the DATABASE enforces integrity even if a service is bypassed.
 */
let h: DbHandle;
let f: ReturnType<typeof twoClients>;
beforeEach(() => {
  h = freshDb();
  f = twoClients(h);
});
afterEach(() => h.close());

const run =
  (sql: string, ...params: unknown[]) =>
  () =>
    h.sqlite.prepare(sql).run(...params);
const FK = /FOREIGN KEY constraint failed/;
const UNIQUE = /UNIQUE constraint failed/;
const CHECK = /CHECK constraint failed/;

function insertLead(overrides: Record<string, unknown> = {}) {
  const v = {
    id: `lead-${Math.random()}`,
    client_id: f.a.client.id,
    pipeline_id: f.a.pipeline.id,
    stage_id: f.a.stages[0]!.id,
    campaign_id: null,
    full_name: 'Test',
    source: 'manual',
    ...overrides,
  };
  return run(
    'INSERT INTO leads (id, client_id, pipeline_id, stage_id, campaign_id, full_name, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
    v.id,
    v.client_id,
    v.pipeline_id,
    v.stage_id,
    v.campaign_id,
    v.full_name,
    v.source,
  );
}

describe('foreign keys', () => {
  it('rejects references to rows that do not exist', () => {
    expect(insertLead({ client_id: 'no-such-client' })).toThrow(FK);
    expect(
      run(
        "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ('s', 'nobody', 'h', '2030-01-01T00:00:00.000Z')",
      ),
    ).toThrow(FK);
    expect(
      run("INSERT INTO client_members (client_id, user_id) VALUES (?, 'nobody')", f.a.client.id),
    ).toThrow(FK);
  });

  it('blocks deleting a client that still has history (no cascade)', () => {
    insertLead()();
    expect(run('DELETE FROM clients WHERE id = ?', f.a.client.id)).toThrow(FK);
  });
});

describe('cross-client invariants at the DB level (composite FKs)', () => {
  it("rejects a lead using another client's pipeline", () => {
    expect(insertLead({ pipeline_id: f.b.pipeline.id, stage_id: f.b.stages[0]!.id })).toThrow(FK);
  });

  it("rejects a stage from a different pipeline than the lead's", () => {
    expect(insertLead({ stage_id: f.b.stages[0]!.id })).toThrow(FK);
  });

  it("rejects another client's campaign", () => {
    expect(insertLead({ campaign_id: f.campaignB.id })).toThrow(FK);
    expect(insertLead({ campaign_id: f.campaignA.id })).not.toThrow();
  });

  it("rejects a task linked to another client's lead", () => {
    insertLead({ id: 'lead-a' })();
    expect(
      run(
        "INSERT INTO tasks (id, client_id, lead_id, assigned_user_id, title) VALUES ('t1', ?, 'lead-a', ?, 'x')",
        f.b.client.id,
        f.admin.id,
      ),
    ).toThrow(FK);
  });

  it('rejects moving a lead to a different client while keeping its pipeline', () => {
    insertLead({ id: 'lead-a' })();
    expect(run("UPDATE leads SET client_id = ? WHERE id = 'lead-a'", f.b.client.id)).toThrow(FK);
  });
});

describe('uniqueness', () => {
  it('user email is unique case-insensitively (stored normalized)', () => {
    expect(() =>
      createUser(h.db, { email: '  ADMIN@Fixture.test ', displayName: 'x', role: 'admin' }),
    ).toThrow(UNIQUE);
    expect(
      run(
        "INSERT INTO users (id, email, display_name, password_hash, role) VALUES ('u', 'Mixed@Case.test', 'x', '!', 'admin')",
      ),
    ).toThrow(CHECK);
  });

  it('membership, default pipeline, primary contact, stage position, session token', () => {
    expect(
      run(
        'INSERT INTO client_members (client_id, user_id) VALUES (?, ?)',
        f.a.client.id,
        f.employee.id,
      ),
    ).toThrow(UNIQUE);
    expect(
      run(
        "INSERT INTO pipelines (id, client_id, name, is_default) VALUES ('p2', ?, 'second', 1)",
        f.a.client.id,
      ),
    ).toThrow(UNIQUE);
    expect(
      run(
        "INSERT INTO pipelines (id, client_id, name, is_default) VALUES ('p3', ?, 'non-default', 0)",
        f.a.client.id,
      ),
    ).not.toThrow();
    run(
      "INSERT INTO client_contacts (id, client_id, name, is_primary) VALUES ('c1', ?, 'one', 1)",
      f.a.client.id,
    )();
    expect(
      run(
        "INSERT INTO client_contacts (id, client_id, name, is_primary) VALUES ('c2', ?, 'two', 1)",
        f.a.client.id,
      ),
    ).toThrow(UNIQUE);
    expect(
      run(
        "INSERT INTO pipeline_stages (id, pipeline_id, name, position) VALUES ('s', ?, 'dup pos', 0)",
        f.a.pipeline.id,
      ),
    ).toThrow(UNIQUE);
    run(
      "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ('s1', ?, 'same', '2030-01-01T00:00:00.000Z')",
      f.admin.id,
    )();
    expect(
      run(
        "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ('s2', ?, 'same', '2030-01-01T00:00:00.000Z')",
        f.admin.id,
      ),
    ).toThrow(UNIQUE);
  });

  it('source external id is unique per client+source only when present', () => {
    insertLead({ id: 'l1' })();
    insertLead({ id: 'l2' })(); // both NULL external ids: allowed
    h.sqlite
      .prepare("UPDATE leads SET source = 'meta', source_external_id = 'fb-1' WHERE id = 'l1'")
      .run();
    expect(
      run("UPDATE leads SET source = 'meta', source_external_id = 'fb-1' WHERE id = 'l2'"),
    ).toThrow(UNIQUE);
  });

  it('phone is NOT unique: repeat enquiries are allowed', () => {
    insertLead({ id: 'p1' })();
    insertLead({ id: 'p2' })();
    h.sqlite.prepare("UPDATE leads SET phone_normalized = '+972500000000'").run();
    expect(
      h.sqlite
        .prepare("SELECT count(*) FROM leads WHERE phone_normalized = '+972500000000'")
        .pluck()
        .get(),
    ).toBe(2);
  });
});

describe('check constraints', () => {
  it('enforces enums and state consistency', () => {
    expect(insertLead({ source: 'scraped' })).toThrow(CHECK);
    expect(run("UPDATE clients SET status = 'archived' WHERE id = ?", f.a.client.id)).toThrow(
      CHECK,
    );
    expect(
      run(
        "UPDATE clients SET status = 'archived', archived_at = '2026-01-01T00:00:00.000Z' WHERE id = ?",
        f.a.client.id,
      ),
    ).not.toThrow();
    expect(
      run(
        "INSERT INTO tasks (id, client_id, assigned_user_id, title, status) VALUES ('t', ?, ?, 'x', 'done')",
        f.b.client.id,
        f.admin.id,
      ),
    ).toThrow(CHECK);
    expect(
      run(
        "INSERT INTO audit_events (id, entity_type, entity_id, action, after_json) VALUES ('a', 'x', 'y', 'z', 'not json')",
      ),
    ).toThrow(CHECK);
  });

  it('timestamps must be canonical UTC ISO (toISOString format)', () => {
    const t = (v: string) =>
      run(
        "INSERT INTO tasks (id, client_id, assigned_user_id, title, due_at) VALUES (?, ?, ?, 'x', ?)",
        `t-${v}`,
        f.a.client.id,
        f.admin.id,
        v,
      );
    expect(t('2026-11-20T10:00:00.000Z')).not.toThrow();
    for (const bad of [
      '2026-11-20T12:00:00+02:00',
      '2026-11-20 10:00:00',
      '2026-11-20T10:00:00Z',
      'tomorrow',
    ]) {
      expect(t(bad), bad).toThrow(CHECK);
    }
  });
});
