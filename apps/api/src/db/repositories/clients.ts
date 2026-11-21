import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  campaigns,
  clientContacts,
  clientMembers,
  clients,
  pipelineStages,
  pipelines,
  type Campaign,
  type Client,
  type ClientContact,
  type ClientMember,
  type NewClient,
  type Pipeline,
  type PipelineStage,
} from '../schema.js';
import type { Executor } from '../tx.js';

export function insertClient(exec: Executor, values: NewClient): Client {
  return exec.insert(clients).values(values).returning().get();
}

export function findClientById(exec: Executor, id: string): Client | undefined {
  return exec.select().from(clients).where(eq(clients.id, id)).get();
}

export function listActiveClients(exec: Executor): Client[] {
  return exec
    .select()
    .from(clients)
    .where(isNull(clients.archivedAt))
    .orderBy(asc(clients.name))
    .all();
}

export function insertMember(
  exec: Executor,
  values: typeof clientMembers.$inferInsert,
): ClientMember {
  return exec.insert(clientMembers).values(values).returning().get();
}

export function insertContact(
  exec: Executor,
  values: typeof clientContacts.$inferInsert,
): ClientContact {
  return exec.insert(clientContacts).values(values).returning().get();
}

export function clearPrimaryContact(exec: Executor, clientId: string): void {
  exec
    .update(clientContacts)
    .set({ isPrimary: false })
    .where(and(eq(clientContacts.clientId, clientId), eq(clientContacts.isPrimary, true)))
    .run();
}

export function insertPipeline(exec: Executor, values: typeof pipelines.$inferInsert): Pipeline {
  return exec.insert(pipelines).values(values).returning().get();
}

export function findPipelineById(exec: Executor, id: string): Pipeline | undefined {
  return exec.select().from(pipelines).where(eq(pipelines.id, id)).get();
}

export function findDefaultPipeline(exec: Executor, clientId: string): Pipeline | undefined {
  return exec
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.clientId, clientId), eq(pipelines.isDefault, true)))
    .get();
}

export function insertStage(
  exec: Executor,
  values: typeof pipelineStages.$inferInsert,
): PipelineStage {
  return exec.insert(pipelineStages).values(values).returning().get();
}

export function findStageById(exec: Executor, id: string): PipelineStage | undefined {
  return exec.select().from(pipelineStages).where(eq(pipelineStages.id, id)).get();
}

export function listStages(exec: Executor, pipelineId: string): PipelineStage[] {
  return exec
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.pipelineId, pipelineId))
    .orderBy(asc(pipelineStages.position))
    .all();
}

export function insertCampaign(exec: Executor, values: typeof campaigns.$inferInsert): Campaign {
  return exec.insert(campaigns).values(values).returning().get();
}

export function findCampaignById(exec: Executor, id: string): Campaign | undefined {
  return exec.select().from(campaigns).where(eq(campaigns.id, id)).get();
}
