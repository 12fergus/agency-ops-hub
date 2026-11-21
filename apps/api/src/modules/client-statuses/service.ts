import { asc, count, eq, max } from 'drizzle-orm';
import type { ClientStatusDto, StatusColor } from '@agency-crm/shared';
import { recordAudit } from '../../db/repositories/audit.js';
import { clientStatuses, clients, type ClientStatusRow } from '../../db/schema.js';
import { withTransaction, type Executor } from '../../db/tx.js';
import { AppError, notFound, validation } from '../../lib/errors.js';
import { requireRole, type Actor } from '../auth/authorize.js';

const conflict = (code: string, message: string) => new AppError(409, code, message);

/**
 * Every logged-in user may read the list (needed to show and pick statuses). Usage counts span
 * ALL clients, so only admins get them (others: null) — no leak of the agency's client numbers.
 */
export function listStatuses(exec: Executor, actor: Actor): ClientStatusDto[] {
  const withCounts = actor.role === 'admin';
  const counts = new Map(
    exec
      .select({ id: clients.statusId, n: count() })
      .from(clients)
      .groupBy(clients.statusId)
      .all()
      .map((r) => [r.id, r.n] as const),
  );
  return exec
    .select()
    .from(clientStatuses)
    .orderBy(asc(clientStatuses.position), asc(clientStatuses.name))
    .all()
    .map((s) => toDto(s, withCounts ? (counts.get(s.id) ?? 0) : null));
}

const toDto = (s: ClientStatusRow, clientCount: number | null): ClientStatusDto => ({
  id: s.id,
  name: s.name,
  color: s.color,
  position: s.position,
  isDefault: s.isDefault,
  clientCount,
});

export function findStatus(exec: Executor, id: string): ClientStatusRow | undefined {
  return exec.select().from(clientStatuses).where(eq(clientStatuses.id, id)).get();
}

export function defaultStatus(exec: Executor): ClientStatusRow {
  const row = exec.select().from(clientStatuses).where(eq(clientStatuses.isDefault, true)).get();
  if (!row) throw new AppError(500, 'INTERNAL', 'No default client status configured');
  return row;
}

/** A statusId from a request must exist; unknown ids are a 422 on the field, never a 500. */
export function requireStatus(exec: Executor, id: string): ClientStatusRow {
  const row = findStatus(exec, id);
  if (!row) {
    throw new AppError(422, 'VALIDATION', 'Invalid input', [
      { path: 'statusId', code: 'invalid_value' },
    ]);
  }
  return row;
}

function nameTaken(exec: Executor, name: string, exceptId?: string) {
  const row = exec.select().from(clientStatuses).where(eq(clientStatuses.name, name)).get();
  return row !== undefined && row.id !== exceptId;
}

export function createStatus(
  exec: Executor,
  actor: Actor,
  input: { name: string; color: StatusColor },
): ClientStatusDto {
  requireRole(actor, 'admin');
  return withTransaction(exec, (tx) => {
    if (nameTaken(tx, input.name))
      throw conflict('STATUS_NAME_TAKEN', 'Status name already exists');
    const last =
      tx
        .select({ p: max(clientStatuses.position) })
        .from(clientStatuses)
        .get()?.p ?? -1;
    const row = tx
      .insert(clientStatuses)
      .values({ name: input.name, color: input.color, position: last + 1 })
      .returning()
      .get();
    recordAudit(tx, {
      actorUserId: actor.id,
      clientId: null,
      entityType: 'client_status',
      entityId: row.id,
      action: 'create',
      after: { name: row.name, color: row.color },
    });
    return toDto(row, 0);
  });
}

export function updateStatus(
  exec: Executor,
  actor: Actor,
  id: string,
  patch: {
    name?: string | undefined;
    color?: StatusColor | undefined;
    isDefault?: true | undefined;
  },
): ClientStatusDto {
  requireRole(actor, 'admin');
  return withTransaction(exec, (tx) => {
    const current = findStatus(tx, id);
    if (!current) throw notFound('Status');
    if (patch.name !== undefined && nameTaken(tx, patch.name, id)) {
      throw conflict('STATUS_NAME_TAKEN', 'Status name already exists');
    }
    if (patch.isDefault) {
      // Exactly one default (partial unique index): clear the old one first.
      tx.update(clientStatuses)
        .set({ isDefault: false })
        .where(eq(clientStatuses.isDefault, true))
        .run();
    }
    const values = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const row = tx
      .update(clientStatuses)
      .set(values)
      .where(eq(clientStatuses.id, id))
      .returning()
      .get();
    recordAudit(tx, {
      actorUserId: actor.id,
      clientId: null,
      entityType: 'client_status',
      entityId: id,
      action: 'update',
      before: { name: current.name, color: current.color, isDefault: current.isDefault },
      after: { name: row.name, color: row.color, isDefault: row.isDefault },
    });
    const n = tx.select({ n: count() }).from(clients).where(eq(clients.statusId, id)).get()?.n ?? 0;
    return toDto(row, n);
  });
}

/** Sets positions from the given order. Must list every status exactly once. */
export function reorderStatuses(exec: Executor, actor: Actor, ids: string[]): ClientStatusDto[] {
  requireRole(actor, 'admin');
  return withTransaction(exec, (tx) => {
    const all = tx
      .select({ id: clientStatuses.id })
      .from(clientStatuses)
      .all()
      .map((r) => r.id);
    const unique = new Set(ids);
    if (
      unique.size !== ids.length ||
      unique.size !== all.length ||
      !all.every((id) => unique.has(id))
    ) {
      throw validation('REORDER_MUST_LIST_ALL_STATUSES');
    }
    ids.forEach((id, position) =>
      tx.update(clientStatuses).set({ position }).where(eq(clientStatuses.id, id)).run(),
    );
    recordAudit(tx, {
      actorUserId: actor.id,
      clientId: null,
      entityType: 'client_status',
      entityId: 'order',
      action: 'reorder',
    });
    return listStatuses(tx, actor);
  });
}

/** Only unused, non-default statuses can be deleted (clients keep a valid status). */
export function deleteStatus(exec: Executor, actor: Actor, id: string): void {
  requireRole(actor, 'admin');
  withTransaction(exec, (tx) => {
    const row = findStatus(tx, id);
    if (!row) throw notFound('Status');
    if (row.isDefault) throw conflict('STATUS_IS_DEFAULT', 'The default status cannot be deleted');
    const n = tx.select({ n: count() }).from(clients).where(eq(clients.statusId, id)).get()?.n ?? 0;
    if (n > 0) throw conflict('STATUS_IN_USE', 'Status is used by clients');
    tx.delete(clientStatuses).where(eq(clientStatuses.id, id)).run();
    recordAudit(tx, {
      actorUserId: actor.id,
      clientId: null,
      entityType: 'client_status',
      entityId: id,
      action: 'delete',
      before: { name: row.name },
    });
  });
}
