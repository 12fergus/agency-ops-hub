import { recordAudit } from '../../db/repositories/audit.js';
import {
  clearPrimaryContact,
  findClientById,
  insertCampaign,
  insertClient,
  insertContact,
  insertMember,
  insertPipeline,
  insertStage,
  listStages,
} from '../../db/repositories/clients.js';
import { findUserById } from '../../db/repositories/users.js';
import type {
  Campaign,
  Client,
  ClientContact,
  ClientMember,
  Pipeline,
  PipelineStage,
} from '../../db/schema.js';
import { withTransaction, type Executor } from '../../db/tx.js';
import { AppError, invalidState, notFound } from '../../lib/errors.js';
import { normalizeEmail } from '../../lib/normalize.js';

/** Default pipeline seeded for every new client (stage names are business data, in Hebrew). */
export const DEFAULT_STAGES = [
  { name: 'חדש', stageType: 'open' },
  { name: 'בטיפול', stageType: 'open' },
  { name: 'ממתין למענה', stageType: 'open' },
  { name: 'נסגר בהצלחה', stageType: 'won' },
  { name: 'לא רלוונטי', stageType: 'lost' },
] as const;

export interface CreateClientInput {
  name: string;
  businessName?: string | null;
  industry?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}

export interface CreatedClient {
  client: Client;
  pipeline: Pipeline;
  stages: PipelineStage[];
}

/** Creates the client + default pipeline + stages atomically. */
export function createClient(
  exec: Executor,
  input: CreateClientInput,
  actorUserId: string | null,
): CreatedClient {
  return withTransaction(exec, (tx) => {
    const client = insertClient(tx, {
      name: input.name.trim(),
      businessName: input.businessName ?? null,
      industry: input.industry ?? null,
      phone: input.phone ?? null,
      email: normalizeEmail(input.email),
      notes: input.notes ?? null,
    });
    const pipeline = insertPipeline(tx, {
      clientId: client.id,
      name: 'ברירת מחדל',
      isDefault: true,
    });
    DEFAULT_STAGES.forEach((s, position) =>
      insertStage(tx, { pipelineId: pipeline.id, name: s.name, stageType: s.stageType, position }),
    );
    recordAudit(tx, {
      actorUserId,
      clientId: client.id,
      entityType: 'client',
      entityId: client.id,
      action: 'create',
      after: client,
    });
    return { client, pipeline, stages: listStages(tx, pipeline.id) };
  });
}

export function requireActiveClient(exec: Executor, clientId: string): Client {
  const client = findClientById(exec, clientId);
  if (!client) throw notFound('Client');
  if (client.archivedAt) throw invalidState('Client is archived');
  return client;
}

export function addClientMember(
  exec: Executor,
  input: { clientId: string; userId: string; membershipRole?: 'owner' | 'collaborator' },
  actorUserId: string | null,
): ClientMember {
  return withTransaction(exec, (tx) => {
    requireActiveClient(tx, input.clientId);
    const user = findUserById(tx, input.userId);
    if (!user) throw notFound('User');
    if (!user.isActive) throw new AppError(422, 'USER_INACTIVE', 'User is disabled');
    const member = insertMember(tx, {
      clientId: input.clientId,
      userId: input.userId,
      membershipRole: input.membershipRole ?? 'collaborator',
    });
    recordAudit(tx, {
      actorUserId,
      clientId: input.clientId,
      entityType: 'client_member',
      entityId: `${input.clientId}:${input.userId}`,
      action: 'create',
      after: member,
    });
    return member;
  });
}

export function addClientContact(
  exec: Executor,
  input: {
    clientId: string;
    name: string;
    title?: string | null;
    phone?: string | null;
    email?: string | null;
    isPrimary?: boolean;
  },
  actorUserId: string | null,
): ClientContact {
  return withTransaction(exec, (tx) => {
    requireActiveClient(tx, input.clientId);
    // Only one primary contact per client (also enforced by a partial unique index).
    if (input.isPrimary) clearPrimaryContact(tx, input.clientId);
    const contact = insertContact(tx, {
      clientId: input.clientId,
      name: input.name.trim(),
      title: input.title ?? null,
      phone: input.phone ?? null,
      email: normalizeEmail(input.email),
      isPrimary: input.isPrimary ?? false,
    });
    recordAudit(tx, {
      actorUserId,
      clientId: input.clientId,
      entityType: 'client_contact',
      entityId: contact.id,
      action: 'create',
      after: contact,
    });
    return contact;
  });
}

export function createCampaign(
  exec: Executor,
  input: {
    clientId: string;
    name: string;
    channel: Campaign['channel'];
    externalId?: string | null;
  },
  actorUserId: string | null,
): Campaign {
  return withTransaction(exec, (tx) => {
    requireActiveClient(tx, input.clientId);
    const campaign = insertCampaign(tx, {
      clientId: input.clientId,
      name: input.name.trim(),
      channel: input.channel,
      externalId: input.externalId ?? null,
    });
    recordAudit(tx, {
      actorUserId,
      clientId: input.clientId,
      entityType: 'campaign',
      entityId: campaign.id,
      action: 'create',
      after: campaign,
    });
    return campaign;
  });
}
