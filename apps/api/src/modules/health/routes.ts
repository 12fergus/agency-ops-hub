import type { FastifyPluginAsync } from 'fastify';
import type { ApiSuccess, Health } from '@agency-crm/shared';
import { pingDatabase } from '../../db/client.js';

const VERSION = '0.0.0';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  // Public by design: used by monitoring before login. Exposes no data.
  app.get(
    '/health',
    { config: { public: true } },
    async (req, reply): Promise<ApiSuccess<Health>> => {
      const ping = pingDatabase(app.dbHandle.sqlite);
      const dbOk = ping.ok;
      if (!ping.ok) {
        // The response stays generic (public route); the reason goes to the server log.
        req.log.error({ err: ping.error }, 'health check: database ping failed');
        reply.code(503);
      }
      return {
        data: {
          status: dbOk ? 'ok' : 'degraded',
          db: dbOk ? 'ok' : 'error',
          version: VERSION,
          time: new Date().toISOString(),
        },
      };
    },
  );
};
