import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { healthSchema } from '@agency-crm/shared';
import { buildApp } from '../src/app/build-app.js';
import { loadConfig } from '../src/lib/config.js';

describe('API skeleton', () => {
  let app: FastifyInstance;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'crm-test-'));
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_PATH: path.join(dir, 'test.sqlite'),
    });
    app = await buildApp(config);
  });

  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('GET /api/v1/health returns ok in the data envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(healthSchema.parse(body.data)).toMatchObject({ status: 'ok', db: 'ok' });
  });

  it('opens SQLite with WAL and foreign keys enforced', () => {
    const { sqlite } = app.dbHandle;
    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('unknown API routes require a session first (no route enumeration), in the error envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
  });
});
