import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app/build-app.js';
import { runMigrations } from '../../src/db/migrator.js';
import { createUser } from '../../src/db/repositories/users.js';
import { loadConfig } from '../../src/lib/config.js';
import { call, loginAs, makeUser, sessionCookieFrom, testApp } from '../helpers/app.js';
import { tempDir } from '../helpers/db.js';

const PW = `Setup-${Math.random().toString(36).slice(2)}-1!`;
const status = async (app: FastifyInstance) =>
  (await call(app, 'GET', '/api/v1/setup/status')).json().data.needsSetup as boolean;
const setup = (app: FastifyInstance, body: Record<string, unknown>) =>
  call(app, 'POST', '/api/v1/setup', { body });

let cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanup.reverse()) await c();
  cleanup = [];
});

async function fresh(env: Record<string, string> = {}) {
  const app = await testApp(env);
  cleanup.push(() => app.close());
  return app;
}

describe('first-run setup page (one-time code)', () => {
  it('is offered only while no login-capable admin exists (demo admins do not count)', async () => {
    const app = await fresh();
    expect(await status(app)).toBe(true);
    createUser(app.dbHandle.db, { email: 'demo@agency.test', displayName: 'D', role: 'admin' });
    expect(await status(app)).toBe(true); // placeholder-password admin can't log in

    await makeUser(app, 'real@agency.test', 'admin');
    expect(await status(app)).toBe(false);
    const res = await setup(app, {
      code: 'X',
      email: 'x@agency.test',
      displayName: 'X',
      password: PW,
    });
    expect(res.statusCode).toBe(404); // the route is gone once an admin exists
  });

  it('rejects a wrong code; the right code creates the admin, logs in, and closes setup', async () => {
    const app = await fresh();
    await status(app); // generates the code
    const code = app.firstRun.currentCodeForProcess()!;
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const wrong = await setup(app, {
      code: 'AAAA-BBBB-CCCC',
      email: 'boss@agency.test',
      displayName: 'B',
      password: PW,
    });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error.code).toBe('SETUP_CODE_INVALID');

    // Lower-case and without dashes is accepted (typed by hand).
    const ok = await setup(app, {
      code: code.toLowerCase().replaceAll('-', ''),
      email: 'Boss@Agency.test',
      displayName: 'הבעלים',
      password: PW,
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().data.user).toMatchObject({
      email: 'boss@agency.test',
      role: 'admin',
      status: 'active',
    });
    const cookie = sessionCookieFrom(ok.headers['set-cookie']);
    expect((await call(app, 'GET', '/api/v1/users', { cookie })).statusCode).toBe(200);

    expect(await status(app)).toBe(false);
    expect(app.firstRun.currentCodeForProcess()).toBeNull();
    expect(
      (await setup(app, { code, email: 'second@agency.test', displayName: 'S', password: PW }))
        .statusCode,
    ).toBe(404);
  });

  it('enforces the password policy', async () => {
    const app = await fresh();
    await status(app);
    const res = await setup(app, {
      code: app.firstRun.currentCodeForProcess(),
      email: 'boss@agency.test',
      displayName: 'B',
      password: 'abcdefgh1',
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toBe('PASSWORD_NEEDS_SYMBOL');
  });

  it('rate-limits guessing', async () => {
    const app = await fresh();
    await status(app);
    for (let i = 0; i < 10; i++) {
      await setup(app, {
        code: `WRONG-${i}`,
        email: 'b@agency.test',
        displayName: 'B',
        password: PW,
      });
    }
    const res = await setup(app, {
      code: app.firstRun.currentCodeForProcess(),
      email: 'b@agency.test',
      displayName: 'B',
      password: PW,
    });
    expect(res.statusCode).toBe(429);
  });

  it('writes the code to setup-code.txt next to the DB (not to the log) and deletes it after use', async () => {
    const t = tempDir();
    cleanup.push(t.cleanup);
    const app = await buildApp(
      loadConfig({ NODE_ENV: 'test', DATABASE_PATH: path.join(t.dir, 'crm.sqlite') }),
    );
    cleanup.push(() => app.close());
    runMigrations(app.dbHandle);
    await app.firstRun.prepare();

    const file = path.join(t.dir, 'setup-code.txt');
    expect(existsSync(file)).toBe(true);
    const code = readFileSync(file, 'utf8').match(/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/)![0];

    const ok = await setup(app, {
      code,
      email: 'boss@agency.test',
      displayName: 'B',
      password: PW,
    });
    expect(ok.statusCode).toBe(201);
    expect(existsSync(file)).toBe(false);
  });
});

describe('first admin from environment variables', () => {
  it('creates the admin once at startup and closes setup', async () => {
    const app = await fresh({
      INITIAL_ADMIN_EMAIL: 'Owner@Agency.test',
      INITIAL_ADMIN_PASSWORD: PW,
      INITIAL_ADMIN_NAME: 'הבעלים',
    });
    await app.firstRun.prepare();
    expect(await status(app)).toBe(false);
    const cookie = await loginAs(app, 'owner@agency.test', PW);
    const me = await call(app, 'GET', '/api/v1/auth/me', { cookie });
    expect(me.json().data.user).toMatchObject({ role: 'admin', displayName: 'הבעלים' });

    await app.firstRun.prepare(); // second start: nothing happens, no duplicate
    const admins = app.dbHandle.sqlite
      .prepare("SELECT count(*) AS n FROM users WHERE role = 'admin'")
      .get();
    expect(admins).toEqual({ n: 1 });
  });

  it('an invalid env password does not crash startup; setup-code mode stays available', async () => {
    const app = await fresh({
      INITIAL_ADMIN_EMAIL: 'owner@agency.test',
      INITIAL_ADMIN_PASSWORD: 'short',
    });
    await expect(app.firstRun.prepare()).resolves.toBeUndefined();
    expect(await status(app)).toBe(true);
    expect(app.firstRun.currentCodeForProcess()).not.toBeNull();
  });

  it('is ignored when an admin already exists', async () => {
    const app = await fresh({
      INITIAL_ADMIN_EMAIL: 'intruder@agency.test',
      INITIAL_ADMIN_PASSWORD: PW,
    });
    await makeUser(app, 'real@agency.test', 'admin');
    await app.firstRun.prepare();
    expect(
      app.dbHandle.sqlite
        .prepare("SELECT count(*) AS n FROM users WHERE email = 'intruder@agency.test'")
        .get(),
    ).toEqual({ n: 0 });
  });
});
