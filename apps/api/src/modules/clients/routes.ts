import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  addMemberSchema,
  clientInputSchema,
  clientListQuerySchema,
  clientPatchSchema,
  contactInputSchema,
  contactPatchSchema,
  idParamSchema,
} from '@agency-crm/shared';
import { actorOf } from '../../app/security.js';
import { listLeadsForClient } from '../../db/repositories/leads.js';
import { parseInput } from '../../lib/validate.js';
import { PHOTO_MAX_BYTES } from '@agency-crm/shared';
import type { Config } from '../../lib/config.js';
import { AppError } from '../../lib/errors.js';
import { authorizeClientAccess } from '../auth/authorize.js';
import { deletePhotoAsActor, readPhotoAsActor, savePhotoAsActor } from './photo.js';
import {
  createClientAsActor,
  createContactAsActor,
  deleteContactAsActor,
  getClientDto,
  listAssignableUsers,
  listContactsAsActor,
  setArchivedAsActor,
  updateClientAsActor,
  updateContactAsActor,
} from './management.js';
import { addMemberAsActor, removeMemberAsActor } from './membership.js';
import { listClientsForActor, listStaff } from './queries.js';

const memberParams = z.object({
  id: z.string().min(1).max(64),
  userId: z.string().min(1).max(64),
});
const contactParams = z.object({
  id: z.string().min(1).max(64),
  contactId: z.string().min(1).max(64),
});

/**
 * Clients module. Every route resolves the actor from the session and authorizes through
 * authorizeClientAccess (or requireRole for create/staff picker); no client/user id from the
 * request is trusted. Clients are archived, never deleted.
 */
export const clientRoutes: FastifyPluginAsync<{ config: Config }> = async (app, { config }) => {
  const db = () => app.dbHandle.db;

  // List: scoped in SQL, paginated (max 100), searchable, filterable, allowlisted sort.
  app.get('/clients', async (req) => {
    const query = parseInput(clientListQuerySchema, req.query);
    const { rows, meta } = listClientsForActor(db(), actorOf(req), query);
    return { data: rows, meta };
  });

  app.post('/clients', async (req, reply) => {
    const input = parseInput(clientInputSchema, req.body);
    reply.code(201);
    return { data: createClientAsActor(db(), actorOf(req), input) };
  });

  app.get('/clients/:id', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    return { data: getClientDto(db(), actorOf(req), id) };
  });

  app.patch('/clients/:id', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    const patch = parseInput(clientPatchSchema, req.body);
    return { data: updateClientAsActor(db(), actorOf(req), id, patch) };
  });

  app.post('/clients/:id/archive', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    return { data: setArchivedAsActor(db(), actorOf(req), id, true) };
  });

  app.post('/clients/:id/unarchive', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    return { data: setArchivedAsActor(db(), actorOf(req), id, false) };
  });

  // ----- assigned staff -----
  app.get('/clients/:id/members', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    authorizeClientAccess(db(), actorOf(req), id, 'client:read');
    return { data: listStaff(db(), id) };
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

  // ----- contacts -----
  app.get('/clients/:id/contacts', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    return { data: listContactsAsActor(db(), actorOf(req), id) };
  });

  app.post('/clients/:id/contacts', async (req, reply) => {
    const { id } = parseInput(idParamSchema, req.params);
    const input = parseInput(contactInputSchema, req.body);
    reply.code(201);
    return { data: createContactAsActor(db(), actorOf(req), id, input) };
  });

  app.patch('/clients/:id/contacts/:contactId', async (req) => {
    const { id, contactId } = parseInput(contactParams, req.params);
    const patch = parseInput(contactPatchSchema, req.body);
    return { data: updateContactAsActor(db(), actorOf(req), id, contactId, patch) };
  });

  app.delete('/clients/:id/contacts/:contactId', async (req) => {
    const { id, contactId } = parseInput(contactParams, req.params);
    deleteContactAsActor(db(), actorOf(req), id, contactId);
    return { data: { ok: true } };
  });

  // ----- photo / logo -----
  app.get('/clients/:id/photo', async (req, reply) => {
    const { id } = parseInput(idParamSchema, req.params);
    const photo = readPhotoAsActor(db(), actorOf(req), id, config.UPLOADS_DIR);
    // Exact sniffed type + nosniff (global header): the browser can't reinterpret the bytes.
    // The URL is versioned (?v=<photoUpdatedAt>), so the user's own browser may keep it; 'private'
    // keeps it out of shared caches. Everything else under /api stays no-store.
    reply
      .type(photo.type)
      .header('content-disposition', 'inline')
      .header('cache-control', 'private, max-age=86400');
    return reply.send(photo.data);
  });

  app.post('/clients/:id/photo', async (req, reply) => {
    const { id } = parseInput(idParamSchema, req.params);
    if (!req.isMultipart()) throw new AppError(415, 'PHOTO_TYPE', 'Expected multipart/form-data');
    const file = await req.file({ limits: { fileSize: PHOTO_MAX_BYTES, files: 1, fields: 0 } });
    if (!file || file.fieldname !== 'photo') {
      throw new AppError(422, 'VALIDATION', 'Invalid input', [{ path: 'photo', code: 'required' }]);
    }
    const data = await file.toBuffer(); // throws 413 when over the limit
    const saved = savePhotoAsActor(db(), actorOf(req), id, data, config.UPLOADS_DIR);
    reply.code(201);
    return { data: saved };
  });

  app.delete('/clients/:id/photo', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    deletePhotoAsActor(db(), actorOf(req), id, config.UPLOADS_DIR);
    return { data: { ok: true } };
  });

  // Staff picker for the assignment controls (admins and managers).
  app.get('/users/assignable', async (req) => ({ data: listAssignableUsers(db(), actorOf(req)) }));

  // Kept from Phase 2 (authorization proof); the leads module comes later.
  app.get('/clients/:id/leads', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    authorizeClientAccess(db(), actorOf(req), id, 'lead:read');
    return { data: listLeadsForClient(db(), id) };
  });
};
