import type { FastifyPluginAsync } from 'fastify';
import {
  idParamSchema,
  taskInputSchema,
  taskListQuerySchema,
  taskPatchSchema,
} from '@agency-crm/shared';
import { actorOf } from '../../app/security.js';
import { parseInput } from '../../lib/validate.js';
import { createTaskAsActor, getTaskDto, listTasksForActor, updateTaskAsActor } from './service.js';

/** Tasks (Phase 4). Scoping and permissions live in the service. No DELETE: cancel instead. */
export const taskRoutes: FastifyPluginAsync = async (app) => {
  const db = () => app.dbHandle.db;

  app.get('/tasks', async (req) => {
    const query = parseInput(taskListQuerySchema, req.query);
    const { rows, total } = listTasksForActor(db(), actorOf(req), query);
    return { data: rows, meta: { page: query.page, pageSize: query.pageSize, total } };
  });

  app.post('/tasks', async (req, reply) => {
    const input = parseInput(taskInputSchema, req.body);
    reply.code(201);
    return { data: createTaskAsActor(db(), actorOf(req), input) };
  });

  app.get('/tasks/:id', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    return { data: getTaskDto(db(), actorOf(req), id) };
  });

  app.patch('/tasks/:id', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    const patch = parseInput(taskPatchSchema, req.body);
    return { data: updateTaskAsActor(db(), actorOf(req), id, patch) };
  });
};
