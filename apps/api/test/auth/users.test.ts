import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createUser } from '../../src/db/repositories/users.js';
import { verifyPassword } from '../../src/lib/password.js';
import { BootstrapRefusedError, bootstrapFirstAdmin } from '../../src/modules/users/service.js';
import { TEST_PASSWORD, call, loginAs, makeUser, testApp } from '../helpers/app.js';

let app: FastifyInstance;
let admin: string;
let empId: string;
beforeEach(async () => {
  app = await testApp();
  await makeUser(app, 'admin@agency.test', 'admin');
  await makeUser(app, 'mgr@agency.test', 'manager');
  empId = (await makeUser(app, 'emp@agency.test', 'employee')).id;
  admin = await loginAs(app, 'admin@agency.test');
});
afterEach(() => app.close());

const NEW_PW = `N3w-${Math.random().toString(36).slice(2)}-pw!`;

describe('admin user management', () => {
  it('only admins can list/create/change role/disable users', async () => {
    for (const email of ['mgr@agency.test', 'emp@agency.test']) {
      const cookie = await loginAs(app, email);
      const denied = await call(app, 'GET', '/api/v1/users', { cookie });
      expect(denied.statusCode).toBe(403);
      // Generic wording: this route has nothing to do with clients.
      expect(denied.json().error).toEqual({
        code: 'FORBIDDEN',
        message: 'You do not have permission for this action',
      });
      expect(
        (
          await call(app, 'POST', '/api/v1/users', {
            cookie,
            body: { email: 'x@agency.test', displayName: 'X', role: 'admin', password: NEW_PW },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await call(app, 'PATCH', `/api/v1/users/${empId}/role`, {
            cookie,
            body: { role: 'admin' },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (await call(app, 'POST', `/api/v1/users/${empId}/disable`, { cookie })).statusCode,
      ).toBe(403);
    }
    const list = await call(app, 'GET', '/api/v1/users', { cookie: admin });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(3);
    expect(list.body).not.toMatch(/argon2|password/i);
  });

  it('creates users with an Argon2id hash; enforces policy and unique email', async () => {
    const res = await call(app, 'POST', '/api/v1/users', {
      cookie: admin,
      body: { email: 'New@Agency.test', displayName: 'חדש', role: 'employee', password: NEW_PW },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({
      email: 'new@agency.test',
      role: 'employee',
      isActive: true,
    });
    const row = app.dbHandle.sqlite
      .prepare("SELECT password_hash FROM users WHERE email='new@agency.test'")
      .get() as { password_hash: string };
    expect(row.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(NEW_PW, row.password_hash)).toBe(true);
    await loginAs(app, 'new@agency.test', NEW_PW);

    const weak = await call(app, 'POST', '/api/v1/users', {
      cookie: admin,
      body: {
        email: 'w@agency.test',
        displayName: 'W',
        role: 'employee',
        password: 'abcdefgh12',
      },
    });
    expect(weak.json().error).toMatchObject({
      code: 'VALIDATION',
      message: 'PASSWORD_NEEDS_SYMBOL',
    });
    // 8 characters with a letter, a digit and a symbol is accepted.
    const ok8 = await call(app, 'POST', '/api/v1/users', {
      cookie: admin,
      body: { email: 'ok8@agency.test', displayName: 'O', role: 'employee', password: 'Abc12!xy' },
    });
    expect(ok8.statusCode).toBe(201);
    const dup = await call(app, 'POST', '/api/v1/users', {
      cookie: admin,
      body: { email: 'EMP@agency.test', displayName: 'D', role: 'employee', password: NEW_PW },
    });
    expect(dup.statusCode).toBe(409);
  });

  it('a role change revokes the user’s sessions (privilege change → re-login)', async () => {
    const emp = await loginAs(app, 'emp@agency.test');
    const res = await call(app, 'PATCH', `/api/v1/users/${empId}/role`, {
      cookie: admin,
      body: { role: 'manager' },
    });
    expect(res.json().data.role).toBe('manager');
    expect((await call(app, 'GET', '/api/v1/auth/me', { cookie: emp })).statusCode).toBe(401);
    const again = await loginAs(app, 'emp@agency.test');
    const me = await call(app, 'GET', '/api/v1/auth/me', { cookie: again });
    expect(me.json().data.user.role).toBe('manager');
  });

  it('disabling a user cuts access immediately, blocks login; enabling restores login', async () => {
    const emp = await loginAs(app, 'emp@agency.test');
    expect(
      (await call(app, 'POST', `/api/v1/users/${empId}/disable`, { cookie: admin })).json().data
        .isActive,
    ).toBe(false);
    expect((await call(app, 'GET', '/api/v1/auth/me', { cookie: emp })).statusCode).toBe(401);
    expect(
      (
        await call(app, 'POST', '/api/v1/auth/login', {
          body: { email: 'emp@agency.test', password: TEST_PASSWORD },
        })
      ).statusCode,
    ).toBe(401);

    await call(app, 'POST', `/api/v1/users/${empId}/enable`, { cookie: admin });
    await loginAs(app, 'emp@agency.test');
  });

  it('is_active is checked per request even if sessions were not revoked', async () => {
    const emp = await loginAs(app, 'emp@agency.test');
    app.dbHandle.sqlite.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(empId);
    expect((await call(app, 'GET', '/api/v1/auth/me', { cookie: emp })).statusCode).toBe(401);
  });

  it('protects against admin lockout', async () => {
    const meId = (await call(app, 'GET', '/api/v1/auth/me', { cookie: admin })).json().data.user.id;
    expect(
      (await call(app, 'POST', `/api/v1/users/${meId}/disable`, { cookie: admin })).json().error
        .code,
    ).toBe('CANNOT_DISABLE_SELF');
    expect(
      (
        await call(app, 'PATCH', `/api/v1/users/${meId}/role`, {
          cookie: admin,
          body: { role: 'employee' },
        })
      ).json().error.code,
    ).toBe('CANNOT_CHANGE_OWN_ROLE');
  });

  it('unknown user ids are 404', async () => {
    expect(
      (await call(app, 'POST', '/api/v1/users/nope/disable', { cookie: admin })).statusCode,
    ).toBe(404);
  });
});

describe('first-admin bootstrap', () => {
  it('refuses when an active admin exists', async () => {
    await expect(
      bootstrapFirstAdmin(app.dbHandle.db, {
        email: 'second@agency.test',
        displayName: 'S',
        password: NEW_PW,
      }),
    ).rejects.toThrow(BootstrapRefusedError);
  });

  it('creates the first admin on an empty database, with policy checks', async () => {
    const fresh = await testApp();
    await expect(
      bootstrapFirstAdmin(fresh.dbHandle.db, {
        email: 'boss@agency.test',
        displayName: 'B',
        password: 'short',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    // Non-admin users (e.g. demo seed) don't block the bootstrap; only an active admin does.
    createUser(fresh.dbHandle.db, { email: 'emp@agency.test', displayName: 'E', role: 'employee' });
    const created = await bootstrapFirstAdmin(fresh.dbHandle.db, {
      email: 'boss@agency.test',
      displayName: 'B',
      password: NEW_PW,
    });
    expect(created.role).toBe('admin');
    await loginAs(fresh, 'boss@agency.test', NEW_PW);
    await fresh.close();
  });

  it('works after the demo seed: demo admins (no usable password) do not block it', async () => {
    const fresh = await testApp();
    const { seedDemo } = await import('../../src/db/seed-demo.js');
    seedDemo(fresh.dbHandle.db, { nodeEnv: 'test', confirmed: true }); // includes a demo admin
    const created = await bootstrapFirstAdmin(fresh.dbHandle.db, {
      email: 'boss@agency.test',
      displayName: 'B',
      password: NEW_PW,
    });
    expect(created.role).toBe('admin');
    const cookie = await loginAs(fresh, 'boss@agency.test', NEW_PW);

    // The real admin is the only login-capable admin: protected from self-lockout…
    const users = (await call(fresh, 'GET', '/api/v1/users', { cookie })).json().data as {
      id: string;
      email: string;
    }[];
    const demoAdmin = users.find((u) => u.email === 'admin@demo-agency.test')!;
    // …while the demo admin can be disabled freely (it never counted as a real admin).
    expect(
      (await call(fresh, 'POST', `/api/v1/users/${demoAdmin.id}/disable`, { cookie })).statusCode,
    ).toBe(200);
    // And a second bootstrap is refused now that a real admin exists.
    await expect(
      bootstrapFirstAdmin(fresh.dbHandle.db, {
        email: 'x@agency.test',
        displayName: 'X',
        password: NEW_PW,
      }),
    ).rejects.toThrow(BootstrapRefusedError);
    await fresh.close();
  });
});
