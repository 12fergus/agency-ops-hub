import { and, asc, count, desc, eq, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import {
  ACTIVE_TASK_STATUSES,
  type TaskDto,
  type TaskInput,
  type taskListQuerySchema,
  type taskPatchSchema,
} from '@agency-crm/shared';
import type { z } from 'zod';
import { recordAudit } from '../../db/repositories/audit.js';
import { findLeadById, insertTask } from '../../db/repositories/leads.js';
import { userCanAccessClient } from '../../db/repositories/users.js';
import {
  clientCommunications,
  clientMembers,
  clients,
  tasks,
  users,
  type Task,
} from '../../db/schema.js';
import { withTransaction, type Executor } from '../../db/tx.js';
import {
  AppError,
  crossClient,
  invalidAssignee,
  invalidState,
  notFound,
} from '../../lib/errors.js';
import { nowIso, parseTimestamp } from '../../lib/normalize.js';
import { authorizeClientAccess, type Actor } from '../auth/authorize.js';
import { requireEditableClient } from '../clients/management.js';
import { likePattern } from '../clients/queries.js';
import { requireActiveClient } from '../clients/service.js';
import { requireCommunicationOfClient } from '../communications/service.js';

export interface CreateTaskInput {
  clientId: string;
  assignedUserId: string;
  title: string;
  leadId?: string | null;
  /** The communication record this follow-up task comes from (must be the same client). */
  communicationId?: string | null;
  description?: string | null;
  /** UTC ISO-8601. */
  dueAt?: string | null;
}

/** Low-level create (also used by the demo seed). Authorization is the CALLER's job. */
export function createTask(
  exec: Executor,
  input: CreateTaskInput,
  actorUserId: string | null,
): Task {
  return withTransaction(exec, (tx) => {
    requireActiveClient(tx, input.clientId);
    if (input.leadId) {
      const lead = findLeadById(tx, input.leadId);
      if (!lead) throw notFound('Lead');
      if (lead.clientId !== input.clientId) throw crossClient('Lead');
      if (lead.archivedAt) throw invalidState('Lead is archived');
    }
    if (input.communicationId) {
      requireCommunicationOfClient(tx, input.clientId, input.communicationId);
    }
    if (!userCanAccessClient(tx, input.assignedUserId, input.clientId)) throw invalidAssignee();

    const task = insertTask(tx, {
      clientId: input.clientId,
      leadId: input.leadId ?? null,
      communicationId: input.communicationId ?? null,
      createdByUserId: actorUserId,
      assignedUserId: input.assignedUserId,
      title: input.title.trim(),
      description: input.description ?? null,
      dueAt: input.dueAt ? parseTimestamp(input.dueAt) : null,
    });
    recordAudit(tx, {
      actorUserId,
      clientId: input.clientId,
      entityType: 'task',
      entityId: task.id,
      action: 'create',
      // Title/description are free text that often names the lead: keep them out of the audit.
      after: {
        id: task.id,
        leadId: task.leadId,
        communicationId: task.communicationId,
        assignedUserId: task.assignedUserId,
        status: task.status,
        dueAt: task.dueAt,
      },
    });
    return task;
  });
}

// ---------- actor-facing API (Phase 4) ----------

const isOverdue = (t: Pick<Task, 'dueAt' | 'status'>, now: string) =>
  !!t.dueAt && t.dueAt < now && (ACTIVE_TASK_STATUSES as readonly string[]).includes(t.status);

/** Non-admins only ever see tasks of clients they are a member of (also after reassignment). */
function scopeCondition(actor: Actor): SQL | undefined {
  if (actor.role === 'admin') return undefined;
  return inArray(
    tasks.clientId,
    sql`(SELECT ${clientMembers.clientId} FROM ${clientMembers} WHERE ${clientMembers.userId} = ${actor.id})`,
  );
}

function toDtos(
  exec: Executor,
  where: SQL | undefined,
  order: SQL[],
  page?: { limit: number; offset: number },
): TaskDto[] {
  const rows = exec
    .select({
      task: tasks,
      clientName: clients.name,
      clientArchivedAt: clients.archivedAt,
      commType: clientCommunications.type,
      commOccurredAt: clientCommunications.occurredAt,
    })
    .from(tasks)
    .innerJoin(clients, eq(clients.id, tasks.clientId))
    .leftJoin(clientCommunications, eq(clientCommunications.id, tasks.communicationId))
    .where(where)
    .orderBy(...order)
    // SQLite: LIMIT -1 = no limit (single-row lookups).
    .limit(page?.limit ?? -1)
    .offset(page?.offset ?? 0)
    .all();
  const userIds = [
    ...new Set(rows.flatMap((r) => [r.task.assignedUserId, r.task.createdByUserId ?? []]).flat()),
  ];
  const names = new Map(
    userIds.length
      ? exec
          .select({ id: users.id, displayName: users.displayName })
          .from(users)
          .where(inArray(users.id, userIds))
          .all()
          .map((u) => [u.id, u.displayName])
      : [],
  );
  const now = nowIso();
  return rows.map((r) => {
    const t = r.task;
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      dueAt: t.dueAt,
      // Archived clients' tasks are read-only history: never flagged as overdue.
      overdue: !r.clientArchivedAt && isOverdue(t, now),
      completedAt: t.completedAt,
      client: { id: t.clientId, name: r.clientName, archived: !!r.clientArchivedAt },
      assignee: { id: t.assignedUserId, displayName: names.get(t.assignedUserId) ?? '' },
      createdBy: t.createdByUserId
        ? { id: t.createdByUserId, displayName: names.get(t.createdByUserId) ?? '' }
        : null,
      communication:
        t.communicationId && r.commType && r.commOccurredAt
          ? { id: t.communicationId, type: r.commType, occurredAt: r.commOccurredAt }
          : null,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      // Read access == membership (or admin) here, so editing only depends on the archive.
      canEdit: !r.clientArchivedAt,
    };
  });
}

type ListParams = z.output<typeof taskListQuerySchema>;

export function listTasksForActor(
  exec: Executor,
  actor: Actor,
  p: ListParams,
): { rows: TaskDto[]; total: number } {
  const where: (SQL | undefined)[] = [scopeCondition(actor)];
  if (p.scope === 'mine') where.push(eq(tasks.assignedUserId, actor.id));
  if (p.status === 'active') where.push(inArray(tasks.status, [...ACTIVE_TASK_STATUSES]));
  else if (p.status !== 'all') where.push(eq(tasks.status, p.status));
  if (p.clientId) where.push(eq(tasks.clientId, p.clientId));
  if (p.assigneeId) where.push(eq(tasks.assignedUserId, p.assigneeId));
  if (p.overdue) {
    where.push(lt(tasks.dueAt, nowIso()), inArray(tasks.status, [...ACTIVE_TASK_STATUSES]));
  }
  if (p.q) where.push(sql`lower(${tasks.title}) LIKE ${likePattern(p.q)} ESCAPE '\\'`);
  // Tasks of archived clients stay readable but drop out of the default (active) work queue.
  // (Not when looking at ONE client: its own page must still show its tasks, read-only.)
  if (p.status === 'active' && !p.clientId) where.push(isNull(clients.archivedAt));
  const cond = and(...where.filter((w): w is SQL => !!w));

  const dir = p.dir === 'desc' ? desc : asc;
  const column = {
    dueAt: tasks.dueAt,
    createdAt: tasks.createdAt,
    updatedAt: tasks.updatedAt,
    title: tasks.title,
  }[p.sort];
  // Tasks without a deadline go last in either direction.
  const order: SQL[] =
    p.sort === 'dueAt'
      ? [sql`${tasks.dueAt} IS NULL`, dir(column), asc(tasks.id)]
      : [dir(column), asc(tasks.id)];

  return withTransaction(exec, (tx) => {
    const total =
      tx
        .select({ n: count() })
        .from(tasks)
        .innerJoin(clients, eq(clients.id, tasks.clientId))
        .where(cond)
        .get()?.n ?? 0;
    const rows = toDtos(tx, cond, order, {
      limit: p.pageSize,
      offset: (p.page - 1) * p.pageSize,
    });
    return { rows, total };
  });
}

/** Inaccessible and missing tasks are both 404 (no probing of other clients' task ids). */
function loadAccessible(tx: Executor, actor: Actor, id: string): Task {
  const task = tx.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!task) throw notFound('Task');
  try {
    authorizeClientAccess(tx, actor, task.clientId, 'client:read');
  } catch (e) {
    if (e instanceof AppError && e.code === 'NOT_FOUND') throw notFound('Task');
    throw e;
  }
  return task;
}

export function getTaskDto(exec: Executor, actor: Actor, id: string): TaskDto {
  return withTransaction(exec, (tx) => {
    loadAccessible(tx, actor, id);
    return toDtos(tx, eq(tasks.id, id), [])[0]!;
  });
}

/**
 * Any member of a non-archived client (or an admin) may create a task and assign it to anyone
 * who can access that client (ADR-020).
 */
export function createTaskAsActor(exec: Executor, actor: Actor, input: TaskInput): TaskDto {
  return withTransaction(exec, (tx) => {
    requireEditableClient(tx, actor, input.clientId);
    const task = createTask(
      tx,
      {
        clientId: input.clientId,
        title: input.title,
        description: input.description ?? null,
        assignedUserId: input.assignedUserId,
        dueAt: input.dueAt ?? null,
        communicationId: input.communicationId ?? null,
      },
      actor.id,
    );
    return toDtos(tx, eq(tasks.id, task.id), [])[0]!;
  });
}

type Patch<T> = { [K in keyof T]?: T[K] | undefined };

export function updateTaskAsActor(
  exec: Executor,
  actor: Actor,
  id: string,
  patch: Patch<z.output<typeof taskPatchSchema>>,
): TaskDto {
  return withTransaction(exec, (tx) => {
    const before = loadAccessible(tx, actor, id);
    requireEditableClient(tx, actor, before.clientId);
    if (
      patch.assignedUserId !== undefined &&
      // Only a CHANGE is validated: keeping a (since deactivated) assignee must not block edits.
      patch.assignedUserId !== before.assignedUserId &&
      !userCanAccessClient(tx, patch.assignedUserId, before.clientId)
    ) {
      throw invalidAssignee();
    }
    const now = nowIso();
    const set: Partial<typeof tasks.$inferInsert> = { updatedAt: now };
    if (patch.title !== undefined) set.title = patch.title.trim();
    if (patch.description !== undefined) set.description = patch.description ?? null;
    if (patch.assignedUserId !== undefined) set.assignedUserId = patch.assignedUserId;
    if (patch.dueAt !== undefined) set.dueAt = patch.dueAt ? parseTimestamp(patch.dueAt) : null;
    if (patch.status !== undefined && patch.status !== before.status) {
      set.status = patch.status;
      // Keeps the tasks_completed_consistent CHECK: completedAt exactly when done.
      set.completedAt = patch.status === 'done' ? now : null;
    }
    const after = tx.update(tasks).set(set).where(eq(tasks.id, id)).returning().get()!;
    const snap = (t: Task) => ({
      assignedUserId: t.assignedUserId,
      status: t.status,
      dueAt: t.dueAt,
    });
    recordAudit(tx, {
      actorUserId: actor.id,
      clientId: before.clientId,
      entityType: 'task',
      entityId: id,
      action: 'update',
      before: snap(before),
      after: snap(after),
    });
    return toDtos(tx, eq(tasks.id, id), [])[0]!;
  });
}
