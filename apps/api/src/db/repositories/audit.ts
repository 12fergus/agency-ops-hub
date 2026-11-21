import { auditEvents } from '../schema.js';
import type { Executor } from '../tx.js';

/** Keys never written to audit snapshots, matched case-insensitively anywhere in the object. */
const SECRET_KEY = /(password|token|secret|hash|api[_-]?key|cookie)/i;

export function sanitizeSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSnapshot);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !SECRET_KEY.test(k))
        .map(([k, v]) => [k, sanitizeSnapshot(v)]),
    );
  }
  return value;
}

export interface AuditInput {
  actorUserId: string | null;
  clientId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
}

export function recordAudit(exec: Executor, input: AuditInput): void {
  const toJson = (v: unknown) => (v === undefined ? null : JSON.stringify(sanitizeSnapshot(v)));
  exec
    .insert(auditEvents)
    .values({
      actorUserId: input.actorUserId,
      clientId: input.clientId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      beforeJson: toJson(input.before),
      afterJson: toJson(input.after),
    })
    .run();
}
