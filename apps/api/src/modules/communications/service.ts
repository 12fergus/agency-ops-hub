import { and, count, desc, eq, inArray } from 'drizzle-orm';
import type { CommunicationDto, CommunicationInput, TaskRef } from '@agency-crm/shared';
import { recordAudit } from '../../db/repositories/audit.js';
import {
  clientCommunications,
  clientContacts,
  tasks,
  users,
  type ClientCommunication,
} from '../../db/schema.js';
import { withTransaction, type Executor } from '../../db/tx.js';
import { AppError, notFound } from '../../lib/errors.js';
import { nowIso, parseTimestamp } from '../../lib/normalize.js';
import { authorizeClientAccess, type Actor } from '../auth/authorize.js';
import { requireEditableClient } from '../clients/management.js';

type Patch<T> = { [K in keyof T]?: T[K] | undefined };

const fieldError = (path: string) =>
  new AppError(422, 'VALIDATION', 'Invalid input', [{ path, code: 'invalid_value' }]);

/** A contact id is only valid for ITS client; anything else is a field error (no probing). */
function requireContactOfClient(tx: Executor, clientId: string, contactId: string): void {
  const row = tx
    .select({ id: clientContacts.id })
    .from(clientContacts)
    .where(and(eq(clientContacts.id, contactId), eq(clientContacts.clientId, clientId)))
    .get();
  if (!row) throw fieldError('contactId');
}

/**
 * Loads a communication the actor may READ. Inaccessible and missing records are both 404, so
 * ids of other clients' records can't be probed.
 */
function loadAccessible(
  tx: Executor,
  actor: Actor,
  id: string,
  action: 'client:read' | 'client:edit',
): ClientCommunication {
  const row = tx.select().from(clientCommunications).where(eq(clientCommunications.id, id)).get();
  if (!row) throw notFound('Communication');
  try {
    authorizeClientAccess(tx, actor, row.clientId, action);
  } catch (e) {
    if (e instanceof AppError && e.code === 'NOT_FOUND') throw notFound('Communication');
    throw e;
  }
  return row;
}

/** Author or admin may edit; the client must not be archived (callers check that too). */
const mayEdit = (actor: Actor, row: ClientCommunication) =>
  actor.role === 'admin' || row.authorUserId === actor.id;

export function toCommunicationDtos(
  exec: Executor,
  actor: Actor,
  rows: ClientCommunication[],
  clientArchived: boolean,
): CommunicationDto[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const userIds = [...new Set(rows.map((r) => r.authorUserId))];
  const contactIds = [...new Set(rows.map((r) => r.contactId).filter((v): v is string => !!v))];

  const authors = new Map(
    exec
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, userIds))
      .all()
      .map((u) => [u.id, u]),
  );
  const contacts = new Map(
    contactIds.length
      ? exec
          .select({ id: clientContacts.id, name: clientContacts.name })
          .from(clientContacts)
          .where(inArray(clientContacts.id, contactIds))
          .all()
          .map((c) => [c.id, c])
      : [],
  );
  const taskRows = exec
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      dueAt: tasks.dueAt,
      communicationId: tasks.communicationId,
      assigneeId: users.id,
      assigneeName: users.displayName,
    })
    .from(tasks)
    .innerJoin(users, eq(users.id, tasks.assignedUserId))
    .where(inArray(tasks.communicationId, ids))
    .orderBy(tasks.createdAt)
    .all();
  const now = nowIso();
  const tasksBy = new Map<string, TaskRef[]>();
  for (const t of taskRows) {
    const list = tasksBy.get(t.communicationId!) ?? [];
    list.push({
      id: t.id,
      title: t.title,
      status: t.status,
      dueAt: t.dueAt,
      overdue:
        !clientArchived &&
        !!t.dueAt &&
        t.dueAt < now &&
        (t.status === 'open' || t.status === 'in_progress'),
      assignee: { id: t.assigneeId, displayName: t.assigneeName },
    });
    tasksBy.set(t.communicationId!, list);
  }

  return rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    type: r.type,
    occurredAt: r.occurredAt,
    summary: r.summary,
    contact: r.contactId ? (contacts.get(r.contactId) ?? null) : null,
    author: authors.get(r.authorUserId) ?? { id: r.authorUserId, displayName: '' },
    tasks: tasksBy.get(r.id) ?? [],
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    canEdit: !clientArchived && mayEdit(actor, r),
  }));
}

/** Newest first. Any member (or admin) may read a client's log. */
export function listCommunicationsAsActor(
  exec: Executor,
  actor: Actor,
  clientId: string,
  page: { page: number; pageSize: number },
): { rows: CommunicationDto[]; total: number } {
  return withTransaction(exec, (tx) => {
    const { client } = authorizeClientAccess(tx, actor, clientId, 'client:read');
    const where = eq(clientCommunications.clientId, clientId);
    const total = tx.select({ n: count() }).from(clientCommunications).where(where).get()?.n ?? 0;
    const rows = tx
      .select()
      .from(clientCommunications)
      .where(where)
      .orderBy(desc(clientCommunications.occurredAt), desc(clientCommunications.id))
      .limit(page.pageSize)
      .offset((page.page - 1) * page.pageSize)
      .all();
    return { rows: toCommunicationDtos(tx, actor, rows, !!client.archivedAt), total };
  });
}

export function getCommunicationDto(exec: Executor, actor: Actor, id: string): CommunicationDto {
  return withTransaction(exec, (tx) => {
    const row = loadAccessible(tx, actor, id, 'client:read');
    const { client } = authorizeClientAccess(tx, actor, row.clientId, 'client:read');
    return toCommunicationDtos(tx, actor, [row], !!client.archivedAt)[0]!;
  });
}

/** Any member of a non-archived client (or an admin) may log a communication. */
export function createCommunicationAsActor(
  exec: Executor,
  actor: Actor,
  clientId: string,
  input: CommunicationInput,
): CommunicationDto {
  return withTransaction(exec, (tx) => {
    requireEditableClient(tx, actor, clientId);
    if (input.contactId) requireContactOfClient(tx, clientId, input.contactId);
    const row = tx
      .insert(clientCommunications)
      .values({
        clientId,
        contactId: input.contactId ?? null,
        authorUserId: actor.id,
        type: input.type,
        occurredAt: parseTimestamp(input.occurredAt),
        summary: input.summary.trim(),
      })
      .returning()
      .get();
    recordAudit(tx, {
      actorUserId: actor.id,
      clientId,
      entityType: 'communication',
      entityId: row.id,
      action: 'create',
      // The summary is free text about the client/people: kept out of the audit log.
      after: { type: row.type, occurredAt: row.occurredAt, contactId: row.contactId },
    });
    return toCommunicationDtos(tx, actor, [row], false)[0]!;
  });
}

/** The author or an admin; never on an archived client. */
export function updateCommunicationAsActor(
  exec: Executor,
  actor: Actor,
  id: string,
  patch: Patch<CommunicationInput>,
): CommunicationDto {
  return withTransaction(exec, (tx) => {
    const row = loadAccessible(tx, actor, id, 'client:edit');
    requireEditableClient(tx, actor, row.clientId);
    if (!mayEdit(actor, row)) {
      throw new AppError(403, 'FORBIDDEN', 'Only the author or an admin may edit this record');
    }
    if (patch.contactId) requireContactOfClient(tx, row.clientId, patch.contactId);
    const set: Partial<typeof clientCommunications.$inferInsert> = { updatedAt: nowIso() };
    if (patch.type !== undefined) set.type = patch.type;
    if (patch.occurredAt !== undefined) set.occurredAt = parseTimestamp(patch.occurredAt);
    if (patch.summary !== undefined) set.summary = patch.summary.trim();
    if (patch.contactId !== undefined) set.contactId = patch.contactId;
    const updated = tx
      .update(clientCommunications)
      .set(set)
      .where(eq(clientCommunications.id, id))
      .returning()
      .get()!;
    recordAudit(tx, {
      actorUserId: actor.id,
      clientId: row.clientId,
      entityType: 'communication',
      entityId: id,
      action: 'update',
      before: { type: row.type, occurredAt: row.occurredAt, contactId: row.contactId },
      after: { type: updated.type, occurredAt: updated.occurredAt, contactId: updated.contactId },
    });
    return toCommunicationDtos(tx, actor, [updated], false)[0]!;
  });
}

/** Used by the tasks service: the record must exist AND belong to that client (else 422). */
export function requireCommunicationOfClient(
  tx: Executor,
  clientId: string,
  communicationId: string,
): void {
  const row = tx
    .select({ id: clientCommunications.id })
    .from(clientCommunications)
    .where(
      and(
        eq(clientCommunications.id, communicationId),
        eq(clientCommunications.clientId, clientId),
      ),
    )
    .get();
  if (!row) throw fieldError('communicationId');
}
