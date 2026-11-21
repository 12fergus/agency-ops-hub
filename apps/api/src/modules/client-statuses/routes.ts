import type { FastifyPluginAsync } from 'fastify';
import {
  clientStatusInputSchema,
  clientStatusPatchSchema,
  idParamSchema,
  statusReorderSchema,
} from '@agency-crm/shared';
import { actorOf } from '../../app/security.js';
import { parseInput } from '../../lib/validate.js';
import {
  createStatus,
  deleteStatus,
  listStatuses,
  reorderStatuses,
  updateStatus,
} from './service.js';

/** Admin-defined client statuses. Read: any logged-in user. Write: admins (checked in service). */
export const clientStatusRoutes: FastifyPluginAsync = async (app) => {
  const db = () => app.dbHandle.db;

  app.get('/client-statuses', async (req) => ({ data: listStatuses(db(), actorOf(req)) }));

  app.post('/client-statuses', async (req, reply) => {
    const input = parseInput(clientStatusInputSchema, req.body);
    reply.code(201);
    return { data: createStatus(db(), actorOf(req), input) };
  });

  app.patch('/client-statuses/:id', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    const patch = parseInput(clientStatusPatchSchema, req.body);
    return { data: updateStatus(db(), actorOf(req), id, patch) };
  });

  app.post('/client-statuses/reorder', async (req) => {
    const { ids } = parseInput(statusReorderSchema, req.body);
    return { data: reorderStatuses(db(), actorOf(req), ids) };
  });

  app.delete('/client-statuses/:id', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    deleteStatus(db(), actorOf(req), id);
    return { data: { ok: true } };
  });
};
