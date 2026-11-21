import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { hashToken } from '../../src/db/repositories/sessions.js';
import {
  ORIGIN,
  TEST_PASSWORD,
  call,
  loginAs,
  makeUser,
  sessionCookieFrom,
  testApp,
} from '../helpers/app.js';

let app: FastifyInstance;
beforeEach(async () => {
  app = await testApp();
  await makeUser(app, 'admin@agency.test', 'admin');
  await makeUser(app, 'emp@agency.test', 'employee');
});
afterEach(() => app.close());

const sql = (q: string, ...p: unknown[]) => app.dbHandle.sqlite.prepare(q).run(...p);
const one = (q: string, ...p: unknown[]) => app.dbHandle.sqlite.prepare(q).get(...p);

describe('default deny', () => {
  it('the public routes are exactly this reviewed list', () => {
    // Adding a public route must be a conscious decision: update this list in the same change.
    const publicRoutes = app.apiRoutes.filter((r) => r.public).map((r) => `${r.method} ${r.url}`);
    expect(publicRoutes.sort()).toEqual(
      [
        'GET /api/v1/health',
        'GET /api/v1/auth/options',
        'POST /api/v1/auth/login',
        'POST /api/v1/auth/signup',
        // First-run setup: only active while no admin exists; POST requires the one-time code.
        'GET /api/v1/setup/status',
        'POST /api/v1/setup',
      ].sort(),
    );
  });

  it('every other API route rejects unauthenticated requests', async () => {
    const routes = app.apiRoutes.filter((r) => !r.public);
    expect(routes.length).toBeGreaterThanOrEqual(10);
    for (const r of routes) {
      const url = r.url.replace(/:(\w+)/g, 'x');
      const res = await call(app, r.method as 'GET', url, {
        body: r.method === 'GET' ? undefined : {},
      });
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('unknown API routes are 401 without a session and 404 with one', async () => {
    expect((await call(app, 'GET', '/api/v1/nope')).statusCode).toBe(401);
    const cookie = await loginAs(app, 'emp@agency.test');
    expect((await call(app, 'GET', '/api/v1/nope', { cookie })).statusCode).toBe(404);
  });

  it('a forged or malformed cookie is rejected', async () => {
    const res = await call(app, 'GET', '/api/v1/auth/me', {
      cookie: `crm_session=${'A'.repeat(43)}`,
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['set-cookie']).toContain('Max-Age=0');
  });
});

describe('encoded paths cannot bypass the security hook', () => {
  it('percent-encoded /api prefixes are still default-deny and CSRF-checked', async () => {
    // find-my-way decodes these to /api/v1/... and routes them to real API handlers.
    for (const url of ['/%61pi/v1/clients', '/api/%76%31/users', '/%41PI/v1/nope']) {
      const res = await call(app, 'GET', url);
      expect(res.statusCode, url).toBe(401);
      expect(res.headers['cache-control'], url).toBe('no-store');
    }
    const cookie = await loginAs(app, 'emp@agency.test');
    const forged = await call(app, 'POST', '/%61pi/v1/auth/logout', {
      cookie,
      origin: 'http://evil.test',
    });
    expect(forged.statusCode).toBe(403);
    expect((await call(app, 'GET', '/api/v1/auth/me', { cookie })).statusCode).toBe(200);
  });
});

describe('login', () => {
  it('sets an HttpOnly SameSite=Lax cookie; the DB stores only the token hash', async () => {
    const res = await call(app, 'POST', '/api/v1/auth/login', {
      body: { email: ' EMP@agency.test ', password: TEST_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const header = String(res.headers['set-cookie']);
    expect(header).toMatch(
      /^crm_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+$/,
    );
    expect(header).not.toContain('Secure'); // plain HTTP in this test

    const token = sessionCookieFrom(header).split('=')[1]!;
    expect(one('SELECT count(*) AS n FROM sessions WHERE token_hash = ?', token)).toEqual({ n: 0 });
    expect(
      one('SELECT count(*) AS n FROM sessions WHERE token_hash = ?', hashToken(token)),
    ).toEqual({ n: 1 });

    const body = res.json();
    expect(body.data.user).toMatchObject({ email: 'emp@agency.test', role: 'employee' });
    expect(JSON.stringify(body)).not.toMatch(/password|hash/i);
  });

  it('marks the cookie Secure when the request came over HTTPS', async () => {
    const secure = await testApp({ COOKIE_SECURE: 'true' });
    await makeUser(secure, 'a@agency.test', 'admin');
    const res = await call(secure, 'POST', '/api/v1/auth/login', {
      body: { email: 'a@agency.test', password: TEST_PASSWORD },
    });
    expect(String(res.headers['set-cookie'])).toContain('; Secure');
    await secure.close();
  });

  it('fails generically for wrong password, unknown email and disabled accounts', async () => {
    await makeUser(app, 'off@agency.test', 'employee');
    sql("UPDATE users SET is_active = 0 WHERE email = 'off@agency.test'");
    const attempts = [
      { email: 'emp@agency.test', password: 'wrong-password-123' },
      { email: 'nobody@agency.test', password: TEST_PASSWORD },
      { email: 'off@agency.test', password: TEST_PASSWORD }, // correct password, disabled
    ];
    for (const body of attempts) {
      const res = await call(app, 'POST', '/api/v1/auth/login', { body });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      });
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  it('rate-limits repeated failures per account, even for the correct password', async () => {
    for (let i = 0; i < 5; i++) {
      await call(app, 'POST', '/api/v1/auth/login', {
        body: { email: 'emp@agency.test', password: `bad-${i}-xxxxxxxx` },
      });
    }
    const res = await call(app, 'POST', '/api/v1/auth/login', {
      body: { email: 'emp@agency.test', password: TEST_PASSWORD },
    });
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    // Other accounts are unaffected.
    expect(
      (
        await call(app, 'POST', '/api/v1/auth/login', {
          body: { email: 'admin@agency.test', password: TEST_PASSWORD },
        })
      ).statusCode,
    ).toBe(200);
  });

  it('parallel guesses cannot exceed the per-account limit', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        call(app, 'POST', '/api/v1/auth/login', {
          body: { email: 'emp@agency.test', password: `parallel-${i}-xxxxxx` },
        }),
      ),
    );
    const codes = attempts.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 401)).toHaveLength(5);
    expect(codes.filter((c) => c === 429)).toHaveLength(7);
  });

  it('accounts without a usable password (e.g. demo users) fail like any other', async () => {
    const { createUser } = await import('../../src/db/repositories/users.js');
    createUser(app.dbHandle.db, { email: 'demo@agency.test', displayName: 'Demo', role: 'admin' });
    const res = await call(app, 'POST', '/api/v1/auth/login', {
      body: { email: 'demo@agency.test', password: '!unusable' },
    });
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('issues a fresh token on every login and revokes the presented old one (no fixation)', async () => {
    const first = await loginAs(app, 'emp@agency.test');
    const res = await call(app, 'POST', '/api/v1/auth/login', {
      cookie: first,
      body: { email: 'emp@agency.test', password: TEST_PASSWORD },
    });
    const second = sessionCookieFrom(res.headers['set-cookie']);
    expect(second).not.toBe(first);
    expect((await call(app, 'GET', '/api/v1/auth/me', { cookie: first })).statusCode).toBe(401);
    expect((await call(app, 'GET', '/api/v1/auth/me', { cookie: second })).statusCode).toBe(200);
  });

  it('validates input without echoing it back', async () => {
    const res = await call(app, 'POST', '/api/v1/auth/login', {
      body: { email: 'not-an-email', password: 'secret-value' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.body).not.toContain('secret-value');
    expect(res.body).not.toContain('not-an-email');
  });
});

describe('sessions', () => {
  it('me returns the current user', async () => {
    const cookie = await loginAs(app, 'emp@agency.test');
    const res = await call(app, 'GET', '/api/v1/auth/me', { cookie });
    expect(res.json().data.user).toMatchObject({ email: 'emp@agency.test', isActive: true });
  });

  it('absolute expiry ends the session', async () => {
    const cookie = await loginAs(app, 'emp@agency.test');
    sql("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'");
    const res = await call(app, 'GET', '/api/v1/auth/me', { cookie });
    expect(res.statusCode).toBe(401);
    expect(String(res.headers['set-cookie'])).toContain('Max-Age=0');
    expect(one('SELECT count(*) AS n FROM sessions WHERE revoked_at IS NOT NULL')).toEqual({
      n: 1,
    });
  });

  it('idle timeout ends the session', async () => {
    const cookie = await loginAs(app, 'emp@agency.test');
    sql("UPDATE sessions SET last_seen_at = '2000-01-01T00:00:00.000Z'");
    expect((await call(app, 'GET', '/api/v1/auth/me', { cookie })).statusCode).toBe(401);
  });

  it('logout revokes the session server-side and clears the cookie', async () => {
    const cookie = await loginAs(app, 'emp@agency.test');
    const res = await call(app, 'POST', '/api/v1/auth/logout', { cookie });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['set-cookie'])).toContain('Max-Age=0');
    // Replaying the old cookie (e.g. stolen copy) no longer works.
    expect((await call(app, 'GET', '/api/v1/auth/me', { cookie })).statusCode).toBe(401);
  });
});

describe('CSRF / cross-origin', () => {
  it('rejects state-changing requests without Origin or from another origin', async () => {
    const cookie = await loginAs(app, 'admin@agency.test');
    const noOrigin = await call(app, 'POST', '/api/v1/auth/logout', { cookie, origin: null });
    expect(noOrigin.statusCode).toBe(403);
    expect(noOrigin.json().error.code).toBe('CSRF_ORIGIN');
    const evil = await call(app, 'POST', '/api/v1/auth/logout', {
      cookie,
      origin: 'http://evil.test',
    });
    expect(evil.statusCode).toBe(403);
    // Login itself is also protected (login CSRF).
    const loginEvil = await call(app, 'POST', '/api/v1/auth/login', {
      origin: 'http://evil.test',
      body: { email: 'admin@agency.test', password: TEST_PASSWORD },
    });
    expect(loginEvil.statusCode).toBe(403);
    // Session still valid: the forged logout had no effect.
    expect((await call(app, 'GET', '/api/v1/auth/me', { cookie })).statusCode).toBe(200);
  });

  it('accepts a matching Referer when Origin is absent, and explicitly trusted origins', async () => {
    const cookie = await loginAs(app, 'emp@agency.test');
    const res = await call(app, 'POST', '/api/v1/auth/logout', {
      cookie,
      origin: null,
      headers: { referer: `${ORIGIN}/users` },
    });
    expect(res.statusCode).toBe(200);

    const trusted = await testApp({ TRUSTED_ORIGINS: 'https://crm.office.test' });
    await makeUser(trusted, 'a@agency.test', 'admin');
    const ok = await call(trusted, 'POST', '/api/v1/auth/login', {
      origin: 'https://crm.office.test',
      body: { email: 'a@agency.test', password: TEST_PASSWORD },
    });
    expect(ok.statusCode).toBe(200);
    await trusted.close();
  });

  it('only JSON bodies are accepted (no form/text "simple requests")', async () => {
    const res = await call(app, 'POST', '/api/v1/auth/login', {
      headers: { 'content-type': 'text/plain' },
      body: 'email=a&password=b',
    });
    expect(res.statusCode).toBe(415);
    const form = await call(app, 'POST', '/api/v1/auth/login', {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'email=a&password=b',
    });
    expect(form.statusCode).toBe(415);
  });

  it('sends security headers and no-store on API responses', async () => {
    const res = await call(app, 'GET', '/api/v1/health');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
