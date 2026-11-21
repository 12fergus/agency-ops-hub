import { and, desc, eq, isNull, ne, or, type SQL } from 'drizzle-orm';
import {
  leadActivities,
  leadImportBatches,
  leads,
  tasks,
  type Lead,
  type LeadActivity,
  type LeadImportBatch,
  type NewLead,
  type Task,
} from '../schema.js';
import type { Executor } from '../tx.js';

export function insertLead(exec: Executor, values: NewLead): Lead {
  return exec.insert(leads).values(values).returning().get();
}

export function findLeadById(exec: Executor, id: string): Lead | undefined {
  return exec.select().from(leads).where(eq(leads.id, id)).get();
}

/** Scoped by client: an id from another client matches nothing and throws. */
export function updateLead(
  exec: Executor,
  clientId: string,
  id: string,
  values: Partial<Omit<NewLead, 'id' | 'clientId'>>,
): Lead {
  const row = exec
    .update(leads)
    .set(values)
    .where(and(eq(leads.id, id), eq(leads.clientId, clientId)))
    .returning()
    .get();
  if (!row) throw new Error('updateLead: lead not found in client');
  return row;
}

export function findImportBatchById(exec: Executor, id: string): LeadImportBatch | undefined {
  return exec.select().from(leadImportBatches).where(eq(leadImportBatches.id, id)).get();
}

export function listLeadsForClient(exec: Executor, clientId: string, limit = 100): Lead[] {
  return exec
    .select()
    .from(leads)
    .where(and(eq(leads.clientId, clientId), isNull(leads.archivedAt)))
    .orderBy(desc(leads.createdAt))
    .limit(Math.min(limit, 100))
    .all();
}

export interface DuplicateCandidate {
  id: string;
  fullName: string;
  matchedOn: ('phone' | 'email')[];
}

/**
 * Same-client, non-archived leads sharing the normalized phone or email.
 * Duplicates are a WARNING, never a constraint: repeat enquiries are legitimate.
 */
export function findDuplicateCandidates(
  exec: Executor,
  clientId: string,
  match: { phoneNormalized: string | null; email: string | null },
  excludeLeadId?: string,
): DuplicateCandidate[] {
  const conds: SQL[] = [];
  if (match.phoneNormalized) conds.push(eq(leads.phoneNormalized, match.phoneNormalized));
  if (match.email) conds.push(eq(leads.email, match.email));
  if (conds.length === 0) return [];

  const filters: (SQL | undefined)[] = [
    eq(leads.clientId, clientId),
    isNull(leads.archivedAt),
    or(...conds),
  ];
  if (excludeLeadId) filters.push(ne(leads.id, excludeLeadId));

  const rows = exec
    .select({
      id: leads.id,
      fullName: leads.fullName,
      phoneNormalized: leads.phoneNormalized,
      email: leads.email,
    })
    .from(leads)
    .where(and(...filters))
    .orderBy(desc(leads.createdAt))
    .limit(10)
    .all();

  return rows.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    matchedOn: [
      ...(match.phoneNormalized && r.phoneNormalized === match.phoneNormalized
        ? (['phone'] as const)
        : []),
      ...(match.email && r.email === match.email ? (['email'] as const) : []),
    ],
  }));
}

export function insertActivity(
  exec: Executor,
  values: typeof leadActivities.$inferInsert,
): LeadActivity {
  return exec.insert(leadActivities).values(values).returning().get();
}

export function insertTask(exec: Executor, values: typeof tasks.$inferInsert): Task {
  return exec.insert(tasks).values(values).returning().get();
}
