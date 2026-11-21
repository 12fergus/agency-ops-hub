import { existsSync } from 'node:fs';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { API_PREFIX } from '@agency-crm/shared';
import type { Config } from '../lib/config.js';
import { openDatabase, type DbHandle } from '../db/client.js';
import { AppError, errorBody } from '../lib/errors.js';
import { authRoutes } from '../modules/auth/routes.js';
import { clientRoutes } from '../modules/clients/routes.js';
import { healthRoutes } from '../modules/health/routes.js';
import { leadRoutes } from '../modules/leads/routes.js';
import { FirstRunSetup } from '../modules/setup/first-run.js';
import { setupRoutes } from '../modules/setup/routes.js';
import { userRoutes } from '../modules/users/routes.js';
import { registerSecurity } from './security.js';

declare module 'fastify' {
  interface FastifyInstance {
    dbHandle: DbHandle;
    /** Registered API routes (method + url); used by the default-deny test sweep. */
    apiRoutes: { method: string; url: string; public: boolean }[];
    /** First-run setup state (one-time setup code, env bootstrap). */
    firstRun: FirstRunSetup;
  }
}

const BODY_LIMIT_BYTES = 1_048_576; // 1 MiB; CSV import will get its own explicit limit.

/** better-sqlite3 constraint errors → safe envelopes (no SQL, no values). */
function mapSqliteError(err: { code?: string }): AppError | null {
  switch (err.code) {
    case 'SQLITE_CONSTRAINT_UNIQUE':
    case 'SQLITE_CONSTRAINT_PRIMARYKEY':
      return new AppError(409, 'CONFLICT', 'A record with these values already exists');
    case 'SQLITE_CONSTRAINT_FOREIGNKEY':
    case 'SQLITE_CONSTRAINT_CHECK':
    case 'SQLITE_CONSTRAINT_NOTNULL':
      return new AppError(422, 'CONSTRAINT', 'The change violates a data rule');
    case 'SQLITE_BUSY':
      return new AppError(503, 'BUSY', 'Database is busy, please retry');
    default:
      return null;
  }
}

export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: BODY_LIMIT_BYTES,
    // Only a reverse proxy on THIS host is trusted: req.ip becomes the address the proxy saw,
    // and client-supplied X-Forwarded-For entries to its left are ignored.
    trustProxy: config.TRUST_PROXY ? 'loopback' : false,
    logger:
      config.NODE_ENV === 'test'
        ? false
        : {
            level: config.LOG_LEVEL,
            // Never log credentials or session values.
            redact: [
              'req.headers.cookie',
              'req.headers.authorization',
              'res.headers["set-cookie"]',
            ],
          },
  });

  const dbHandle = openDatabase(config.DATABASE_PATH);
  app.decorate('dbHandle', dbHandle);
  app.addHook('onClose', async () => dbHandle.close());
  app.decorate('firstRun', new FirstRunSetup(dbHandle, config, app.log));

  app.setErrorHandler<FastifyError>((err, req, reply) => {
    const mapped = err instanceof AppError ? err : mapSqliteError(err);
    if (mapped) {
      return reply
        .code(mapped.statusCode)
        .send(errorBody(mapped.code, mapped.message, mapped.details));
    }
    const status =
      typeof err.statusCode === 'number' && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    // Fastify's own 4xx (bad JSON, body too large, 415) are safe to surface; 5xx details are not.
    // 5xx: fixed code and message (no SQLITE_* or other internals in responses).
    if (status >= 500)
      return reply.code(status).send(errorBody('INTERNAL', 'Internal server error'));
    return reply.code(status).send(errorBody(err.code ?? 'BAD_REQUEST', err.message));
  });

  registerSecurity(app, config);

  const apiRoutes: FastifyInstance['apiRoutes'] = [];
  app.decorate('apiRoutes', apiRoutes);
  app.addHook('onRoute', (r) => {
    if (!r.url.startsWith(API_PREFIX)) return;
    for (const method of [r.method].flat()) {
      if (method === 'HEAD') continue;
      apiRoutes.push({ method, url: r.url, public: r.config?.public === true });
    }
  });

  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(authRoutes, { config });
      await api.register(setupRoutes, { config });
      await api.register(userRoutes);
      await api.register(clientRoutes);
      await api.register(leadRoutes);
    },
    { prefix: API_PREFIX },
  );

  const serveSpa = config.NODE_ENV === 'production' && existsSync(config.webDistPath);
  if (serveSpa) {
    await app.register(fastifyStatic, { root: config.webDistPath, wildcard: false });
  }

  app.setNotFoundHandler((req, reply) => {
    if (serveSpa && req.method === 'GET' && !req.url.startsWith('/api/')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send(errorBody('NOT_FOUND', 'Route not found'));
  });

  return app;
}
