import type { FastifyPluginAsync } from 'fastify';
import {
  communicationInputSchema,
  communicationListQuerySchema,
  communicationPatchSchema,
  idParamSchema,
} from '@agency-crm/shared';
import { actorOf } from '../../app/security.js';
import { parseInput } from '../../lib/validate.js';
import {
  createCommunicationAsActor,
  getCommunicationDto,
  listCommunicationsAsActor,
  updateCommunicationAsActor,
} from './service.js';

/** Client communication log (Phase 4). All access rules live in the service. */
export const communicationRoutes: FastifyPluginAsync = async (app) => {
  const db = () => app.dbHandle.db;

  app.get('/clients/:id/communications', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    const page = parseInput(communicationListQuerySchema, req.query);
    const { rows, total } = listCommunicationsAsActor(db(), actorOf(req), id, page);
    return { data: rows, meta: { page: page.page, pageSize: page.pageSize, total } };
  });

  app.post('/clients/:id/communications', async (req, reply) => {
    const { id } = parseInput(idParamSchema, req.params);
    const input = parseInput(communicationInputSchema, req.body);
    reply.code(201);
    return { data: createCommunicationAsActor(db(), actorOf(req), id, input) };
  });

  app.get('/communications/:id', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    return { data: getCommunicationDto(db(), actorOf(req), id) };
  });

  app.patch('/communications/:id', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    const patch = parseInput(communicationPatchSchema, req.body);
    return { data: updateCommunicationAsActor(db(), actorOf(req), id, patch) };
  });
};
