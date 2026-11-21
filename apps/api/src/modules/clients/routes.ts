import type { FastifyPluginAsync } from 'fastify';
import { asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { addMemberSchema, idParamSchema } from '@agency-crm/shared';
import { actorOf } from '../../app/security.js';
import { listLeadsForClient } from '../../db/repositories/leads.js';
import { clientMembers, clients, type Client } from '../../db/schema.js';
import type { Executor } from '../../db/tx.js';
import { parseInput } from '../../lib/validate.js';
import { authorizeClientAccess, type Actor } from '../auth/authorize.js';
import { addMemberAsActor, listMembersAsActor, removeMemberAsActor } from './membership.js';

/** Admins: all non-archived clients. Others: only clients they are a member of (query-scoped). */
export function listClientsForActor(exec: Executor, actor: Actor): Client[] {
  if (actor.role === 'admin') {
    return exec
      .select()
      .from(clients)
      .where(isNull(clients.archivedAt))
      .orderBy(asc(clients.name))
      .all();
  }
  return exec
    .select({ client: clients })
    .from(clients)
    .innerJoin(clientMembers, eq(clientMembers.clientId, clients.id))
    .where(eq(clientMembers.userId, actor.id))
    .orderBy(asc(clients.name))
    .all()
    .map((r) => r.client)
    .filter((c) => c.archivedAt === null);
}

const memberParams = z.object({ id: z.string().min(1).max(64), userId: z.string().min(1).max(64) });

export const clientRoutes: FastifyPluginAsync = async (app) => {
  const db = () => app.dbHandle.db;

  app.get('/clients', async (req) => ({ data: listClientsForActor(db(), actorOf(req)) }));

  app.get('/clients/:id', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    return { data: authorizeClientAccess(db(), actorOf(req), id, 'client:read').client };
  });

  app.get('/clients/:id/members', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    return { data: listMembersAsActor(db(), actorOf(req), id) };
  });

  app.post('/clients/:id/members', async (req, reply) => {
    const { id } = parseInput(idParamSchema, req.params);
    const input = parseInput(addMemberSchema, req.body);
    reply.code(201);
    return { data: addMemberAsActor(db(), actorOf(req), id, input) };
  });

  app.delete('/clients/:id/members/:userId', async (req) => {
    const { id, userId } = parseInput(memberParams, req.params);
    removeMemberAsActor(db(), actorOf(req), id, userId);
    return { data: { ok: true } };
  });

  app.get('/clients/:id/leads', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    authorizeClientAccess(db(), actorOf(req), id, 'lead:read');
    return { data: listLeadsForClient(db(), id) };
  });
};
