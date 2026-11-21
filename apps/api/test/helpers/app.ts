import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../../src/app/build-app.js';
import { runMigrations } from '../../src/db/migrator.js';
import type { UserRole } from '../../src/db/schema.js';
import { loadConfig } from '../../src/lib/config.js';
import { createUserWithPassword } from '../../src/modules/users/service.js';

export const HOST = 'crm.test';
export const ORIGIN = `http://${HOST}`;

/** Test-only password, generated per run; never a real credential. */
export const TEST_PASSWORD = `T3st-${Math.random().toString(36).slice(2)}-pw!`;

export async function testApp(env: Record<string, string> = {}): Promise<FastifyInstance> {
  const app = await buildApp(loadConfig({ NODE_ENV: 'test', DATABASE_PATH: ':memory:', ...env }));
  runMigrations(app.dbHandle);
  return app;
}

export async function makeUser(
  app: FastifyInstance,
  email: string,
  role: UserRole,
  password = TEST_PASSWORD,
) {
  return createUserWithPassword(
    app.dbHandle.db,
    { email, displayName: email.split('@')[0]!, role, password },
    null,
  );
}

export interface Call {
  cookie?: string | null;
  body?: unknown;
  origin?: string | null;
  headers?: Record<string, string>;
}

/** Browser-like request: same Host, same-origin Origin on writes, JSON body. */
export function call(
  app: FastifyInstance,
  method: InjectOptions['method'],
  url: string,
  c: Call = {},
): Promise<LightMyRequestResponse> {
  const headers: Record<string, string> = { host: HOST, ...c.headers };
  if (c.origin !== null && method !== 'GET') headers.origin = c.origin ?? ORIGIN;
  if (c.cookie) headers.cookie = c.cookie;
  const opts: InjectOptions = { url, headers };
  if (method) opts.method = method;
  if (c.body !== undefined) opts.payload = c.body as NonNullable<InjectOptions['payload']>;
  return app.inject(opts);
}

/** Logs in and returns the `crm_session=…` cookie pair. */
export async function loginAs(app: FastifyInstance, email: string, password = TEST_PASSWORD) {
  const res = await call(app, 'POST', '/api/v1/auth/login', { body: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  return sessionCookieFrom(res.headers['set-cookie']);
}

export function sessionCookieFrom(header: string | string[] | number | undefined): string {
  const raw = Array.isArray(header) ? (header[0] ?? '') : String(header ?? '');
  return raw.split(';')[0]!;
}
