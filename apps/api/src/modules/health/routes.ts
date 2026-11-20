import type { FastifyPluginAsync } from 'fastify';
import type { ApiSuccess, Health } from '@agency-crm/shared';
import { pingDatabase } from '../../db/client.js';

const VERSION = '0.0.0';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async (_req, reply): Promise<ApiSuccess<Health>> => {
    const dbOk = pingDatabase(app.dbHandle.sqlite);
    if (!dbOk) reply.code(503);
    return {
      data: {
        status: dbOk ? 'ok' : 'degraded',
        db: dbOk ? 'ok' : 'error',
        version: VERSION,
        time: new Date().toISOString(),
      },
    };
  });
};
