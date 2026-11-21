import { findClientById } from '../../db/repositories/clients.js';
import { findLeadById } from '../../db/repositories/leads.js';
import { findMembership } from '../../db/repositories/users.js';
import type { Client, ClientMember, Lead, UserRole } from '../../db/schema.js';
import type { Executor } from '../../db/tx.js';
import { AppError, forbidden, notFound } from '../../lib/errors.js';

/** The authenticated user, re-loaded from the DB on every request (so changes apply immediately). */
export interface Actor {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  sessionId: string;
}

export type ClientAction =
  | 'client:read'
  | 'client:edit'
  | 'client:archive'
  | 'client:manageMembers'
  | 'lead:read'
  | 'lead:write'
  | 'lead:export';

export interface ClientAccess {
  client: Client;
  /** null for admins without a membership row. */
  membership: ClientMember | null;
}

/**
 * THE authorization check for anything scoped to a client. Every route that touches client data
 * must go through this (or `authorizeLeadAccess`).
 *
 * - admin: everything.
 * - manager/employee: only clients they are a member of. A non-member gets 404 NOT_FOUND, the same
 *   as a non-existent id, so other clients' IDs can't be probed.
 * - client:edit: any member (ADR-019). client:manageMembers: owner-managers only (ADR-012/018).
 * - client:archive: admins only.
 * - lead:export: admins and member managers.
 */
export function authorizeClientAccess(
  exec: Executor,
  actor: Actor,
  clientId: string,
  action: ClientAction,
): ClientAccess {
  const client = findClientById(exec, clientId);
  if (!client) throw notFound('Client');
  if (actor.role === 'admin') {
    return { client, membership: findMembership(exec, clientId, actor.id) ?? null };
  }

  const membership = findMembership(exec, clientId, actor.id);
  if (!membership) throw notFound('Client');

  switch (action) {
    // Any assigned member (employee, collaborator or owner) may read and edit the client's
    // details, status and contacts (ADR-019).
    case 'client:read':
    case 'client:edit':
    case 'lead:read':
    case 'lead:write':
      return { client, membership };
    case 'lead:export':
      if (actor.role === 'manager') return { client, membership };
      throw forbidden();
    // Managing staff: managers who OWN the client.
    case 'client:manageMembers':
      if (actor.role === 'manager' && membership.membershipRole === 'owner') {
        return { client, membership };
      }
      throw forbidden();
    // Archive/unarchive: admins only (handled above). Members see the client but may not.
    case 'client:archive':
      throw forbidden();
  }
}

/** Loads a lead the actor may access; inaccessible and missing leads are indistinguishable. */
export function authorizeLeadAccess(
  exec: Executor,
  actor: Actor,
  leadId: string,
  action: Extract<ClientAction, 'lead:read' | 'lead:write'>,
): Lead {
  const lead = findLeadById(exec, leadId);
  if (!lead) throw notFound('Lead');
  try {
    authorizeClientAccess(exec, actor, lead.clientId, action);
  } catch (e) {
    if (e instanceof AppError && e.code === 'NOT_FOUND') throw notFound('Lead');
    throw e;
  }
  return lead;
}

export function requireRole(actor: Actor, ...roles: UserRole[]): void {
  if (!roles.includes(actor.role)) throw forbidden();
}
