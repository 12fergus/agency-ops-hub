import { existsSync } from 'node:fs';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { API_PREFIX } from '@agency-crm/shared';
import type { Config } from '../lib/config.js';
import { openDatabase, type DbHandle } from '../db/client.js';
import { AppError, errorBody } from '../lib/errors.js';
import { healthRoutes } from '../modules/health/routes.js';

declare module 'fastify' {
  interface FastifyInstance {
    dbHandle: DbHandle;
  }
}

const BODY_LIMIT_BYTES = 1_048_576; // 1 MiB; CSV import will get its own explicit limit.

export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: BODY_LIMIT_BYTES,
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

  app.setErrorHandler<FastifyError>((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send(errorBody(err.code, err.message, err.details));
    }
    const status =
      typeof err.statusCode === 'number' && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    // Fastify's own 4xx (bad JSON, body too large) are safe to surface; 5xx details are not.
    const message = status >= 500 ? 'Internal server error' : err.message;
    return reply.code(status).send(errorBody(err.code ?? 'INTERNAL', message));
  });

  await app.register(healthRoutes, { prefix: API_PREFIX });

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
