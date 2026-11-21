import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { idParamSchema } from '@agency-crm/shared';
import { actorOf } from '../../app/security.js';
import { parseInput } from '../../lib/validate.js';
import { authorizeLeadAccess } from '../auth/authorize.js';
import { logActivity } from './service.js';

const activitySchema = z.object({
  type: z.enum(['note', 'call', 'whatsapp', 'email', 'meeting']),
  body: z.string().trim().max(5000).optional(),
  occurredAt: z.string().max(40).optional(),
});

export const leadRoutes: FastifyPluginAsync = async (app) => {
  const db = () => app.dbHandle.db;

  app.get('/leads/:id', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    return { data: authorizeLeadAccess(db(), actorOf(req), id, 'lead:read') };
  });

  app.post('/leads/:id/activities', async (req, reply) => {
    const { id } = parseInput(idParamSchema, req.params);
    const input = parseInput(activitySchema, req.body);
    const actor = actorOf(req);
    authorizeLeadAccess(db(), actor, id, 'lead:write');
    reply.code(201);
    return {
      data: logActivity(
        db(),
        {
          leadId: id,
          type: input.type,
          body: input.body ?? null,
          ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
        },
        actor.id,
      ),
    };
  });
};
