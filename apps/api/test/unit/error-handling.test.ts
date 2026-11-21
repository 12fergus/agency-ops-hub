import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backupDatabase } from '../../src/db/backup.js';
import { openDatabase } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrator.js';
import { cliError, runCli } from '../../src/cli/run.js';
import { parseTimestamp } from '../../src/lib/normalize.js';
import { testApp } from '../helpers/app.js';

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe('backupDatabase failure path', () => {
  it('reports the REAL cause and leaves no file that looks like a valid backup', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'crm-bkp-'));
    const handle = openDatabase(path.join(dir, 'live.sqlite'));
    runMigrations(handle);
    handle.close(); // backing up a closed connection fails inside the try

    const err = await backupDatabase(handle.sqlite, path.join(dir, 'backups')).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/^Backup failed, no usable backup written: /);
    expect(err.message).toMatch(/not open/i); // original reason preserved, not a cleanup error
    expect(err.cause).toBeInstanceOf(Error);
    const left = readdirSync(path.join(dir, 'backups'));
    expect(left.filter((f) => f.endsWith('.sqlite'))).toEqual([]);
  });
});

describe('health check', () => {
  it('reports 503 degraded when the database is unavailable (and does not throw)', async () => {
    const app = await testApp();
    app.dbHandle.sqlite.close();
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json().data).toMatchObject({ status: 'degraded', db: 'error' });
    expect(res.body).not.toMatch(/not open|sqlite/i); // reason is logged, not exposed
    await app.close(); // closing an already-closed DB connection is a no-op
  });
});

describe('parseTimestamp', () => {
  it('maps bad input to 422 VALIDATION', () => {
    expect(() => parseTimestamp('2026-01-01 10:00')).toThrow(
      expect.objectContaining({ code: 'VALIDATION' }),
    );
  });
});

describe('CLI runner', () => {
  it('prints one clear line with the cause and sets exit code 1 instead of crashing', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await runCli('demo', () => {
      throw cliError('FAILED — nothing was written.', new Error('disk full'));
    });
    expect(process.exitCode).toBe(1);
    expect(log).toHaveBeenCalledWith('[demo] FAILED — nothing was written. (cause: disk full)');
  });

  it('leaves the exit code alone on success', async () => {
    await runCli('demo', async () => undefined);
    expect(process.exitCode).toBeUndefined();
  });
});
