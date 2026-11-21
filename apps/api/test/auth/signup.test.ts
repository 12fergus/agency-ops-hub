import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { call, loginAs, makeUser, sessionCookieFrom, testApp } from '../helpers/app.js';

const PW = `Sign-${Math.random().toString(36).slice(2)}-up1!`;
const signup = (app: FastifyInstance, body: Record<string, unknown>) =>
  call(app, 'POST', '/api/v1/auth/signup', { body });

let app: FastifyInstance;
beforeEach(async () => {
  app = await testApp();
  await makeUser(app, 'admin@agency.test', 'admin');
});
afterEach(() => app.close());

describe('self-signup (default: instant login)', () => {
  it('creates an active employee and logs them in immediately', async () => {
    const res = await signup(app, { email: 'New@Agency.test', displayName: 'חדש', password: PW });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({
      status: 'active',
      user: { email: 'new@agency.test', role: 'employee', status: 'active' },
    });
    const cookie = sessionCookieFrom(res.headers['set-cookie']);
    expect(String(res.headers['set-cookie'])).toContain('HttpOnly');

    const me = await call(app, 'GET', '/api/v1/auth/me', { cookie });
    expect(me.json().data.user.email).toBe('new@agency.test');
  });

  it('a signed-up user sees NO client data and no admin pages until assigned', async () => {
    const { createClient } = await import('../../src/modules/clients/service.js');
    const client = createClient(app.dbHandle.db, { name: 'Secret client' }, null).client;
    const res = await signup(app, { email: 'x@agency.test', displayName: 'X', password: PW });
    const cookie = sessionCookieFrom(res.headers['set-cookie']);

    expect((await call(app, 'GET', '/api/v1/clients', { cookie })).json().data).toEqual([]);
    expect((await call(app, 'GET', `/api/v1/clients/${client.id}`, { cookie })).statusCode).toBe(
      404,
    );
    expect((await call(app, 'GET', '/api/v1/users', { cookie })).statusCode).toBe(403);
  });

  it('never grants a role from the request body', async () => {
    const res = await signup(app, {
      email: 'sneaky@agency.test',
      displayName: 'S',
      password: PW,
      role: 'admin',
    });
    expect(res.json().data.user.role).toBe('employee');
  });

  it('an already-registered email is rejected (cannot be logged in as someone else)', async () => {
    const res = await signup(app, { email: 'ADMIN@agency.test', displayName: 'X', password: PW });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('EMAIL_TAKEN');
    expect(res.headers['set-cookie']).toBeUndefined();
    await loginAs(app, 'admin@agency.test'); // existing account untouched
  });

  it('enforces the password policy with the specific rule', async () => {
    const res = await signup(app, {
      email: 'w@agency.test',
      displayName: 'W',
      password: 'abcdefgh1',
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({
      code: 'VALIDATION',
      message: 'PASSWORD_NEEDS_SYMBOL',
    });
  });

  it('is rate-limited per IP and CSRF-protected', async () => {
    for (let i = 0; i < 5; i++) {
      await signup(app, { email: `s${i}@agency.test`, displayName: 'S', password: PW });
    }
    const limited = await signup(app, { email: 's9@agency.test', displayName: 'S', password: PW });
    expect(limited.statusCode).toBe(429);
    const evil = await call(app, 'POST', '/api/v1/auth/signup', {
      origin: 'http://evil.test',
      body: { email: 'e@agency.test', displayName: 'E', password: PW },
    });
    expect(evil.statusCode).toBe(403);
  });

  it('options tell the UI the mode; SELF_SIGNUP=false hides it', async () => {
    expect((await call(app, 'GET', '/api/v1/auth/options')).json()).toEqual({
      data: { signupEnabled: true, signupRequiresApproval: false },
    });
    const closed = await testApp({ SELF_SIGNUP: 'false' });
    expect((await call(closed, 'GET', '/api/v1/auth/options')).json().data.signupEnabled).toBe(
      false,
    );
    const res = await signup(closed, { email: 'x@agency.test', displayName: 'X', password: PW });
    expect(res.statusCode).toBe(404);
    await closed.close();
  });
});

describe('self-signup with SIGNUP_REQUIRES_APPROVAL=true', () => {
  let strict: FastifyInstance;
  let strictAdmin: string;
  beforeEach(async () => {
    strict = await testApp({ SIGNUP_REQUIRES_APPROVAL: 'true' });
    await makeUser(strict, 'admin@agency.test', 'admin');
    strictAdmin = await loginAs(strict, 'admin@agency.test');
  });
  afterEach(() => strict.close());

  it('creates a PENDING account: no session, no login until an admin approves', async () => {
    const res = await signup(strict, { email: 'p@agency.test', displayName: 'P', password: PW });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ data: { status: 'pending' } });
    expect(res.headers['set-cookie']).toBeUndefined();

    const login = await call(strict, 'POST', '/api/v1/auth/login', {
      body: { email: 'p@agency.test', password: PW },
    });
    expect(login.json().error.code).toBe('INVALID_CREDENTIALS');

    const users = (await call(strict, 'GET', '/api/v1/users', { cookie: strictAdmin })).json()
      .data as { id: string; email: string; status: string }[];
    const pending = users.find((u) => u.email === 'p@agency.test')!;
    expect(pending.status).toBe('pending');
    const approved = await call(strict, 'POST', `/api/v1/users/${pending.id}/enable`, {
      cookie: strictAdmin,
    });
    expect(approved.json().data.status).toBe('active');
    await loginAs(strict, 'p@agency.test', PW);
  });

  it('does not reveal whether an email is already registered', async () => {
    const existing = await signup(strict, {
      email: 'admin@agency.test',
      displayName: 'X',
      password: PW,
    });
    const fresh = await signup(strict, {
      email: 'brand-new@agency.test',
      displayName: 'X',
      password: PW,
    });
    expect(existing.statusCode).toBe(fresh.statusCode);
    expect(existing.json()).toEqual(fresh.json());
  });
});
