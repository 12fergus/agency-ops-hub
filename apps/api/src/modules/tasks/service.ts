import { recordAudit } from '../../db/repositories/audit.js';
import { findLeadById, insertTask } from '../../db/repositories/leads.js';
import { userCanAccessClient } from '../../db/repositories/users.js';
import type { Task } from '../../db/schema.js';
import { withTransaction, type Executor } from '../../db/tx.js';
import { crossClient, invalidAssignee, invalidState, notFound } from '../../lib/errors.js';
import { parseTimestamp } from '../../lib/normalize.js';
import { requireActiveClient } from '../clients/service.js';

export interface CreateTaskInput {
  clientId: string;
  assignedUserId: string;
  title: string;
  leadId?: string | null;
  description?: string | null;
  /** UTC ISO-8601. */
  dueAt?: string | null;
}

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
    if (!userCanAccessClient(tx, input.assignedUserId, input.clientId)) throw invalidAssignee();

    const task = insertTask(tx, {
      clientId: input.clientId,
      leadId: input.leadId ?? null,
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
        assignedUserId: task.assignedUserId,
        status: task.status,
        dueAt: task.dueAt,
      },
    });
    return task;
  });
}
