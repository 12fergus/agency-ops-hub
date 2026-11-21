import type { FastifyPluginAsync } from 'fastify';
import { changeRoleSchema, createUserSchema, idParamSchema } from '@agency-crm/shared';
import { actorOf } from '../../app/security.js';
import { parseInput } from '../../lib/validate.js';
import {
  changeRoleAsAdmin,
  createUserAsAdmin,
  listUsersAsAdmin,
  setActiveAsAdmin,
} from './service.js';

/** Admin-only user management. Role checks happen in the service, not only here. */
export const userRoutes: FastifyPluginAsync = async (app) => {
  const db = () => app.dbHandle.db;

  app.get('/users', async (req) => ({ data: listUsersAsAdmin(db(), actorOf(req)) }));

  app.post('/users', async (req, reply) => {
    const input = parseInput(createUserSchema, req.body);
    const user = await createUserAsAdmin(db(), actorOf(req), input);
    reply.code(201);
    return { data: user };
  });

  app.patch('/users/:id/role', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    const { role } = parseInput(changeRoleSchema, req.body);
    return { data: changeRoleAsAdmin(db(), actorOf(req), id, role) };
  });

  app.post('/users/:id/disable', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    return { data: setActiveAsAdmin(db(), actorOf(req), id, false) };
  });

  app.post('/users/:id/enable', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    return { data: setActiveAsAdmin(db(), actorOf(req), id, true) };
  });
};
