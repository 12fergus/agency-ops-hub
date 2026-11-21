import { and, eq } from 'drizzle-orm';
import { recordAudit } from '../../db/repositories/audit.js';
import { findMembership, findUserById } from '../../db/repositories/users.js';
import { clientMembers, type ClientMember } from '../../db/schema.js';
import { withTransaction, type Executor } from '../../db/tx.js';
import { AppError, forbidden, invalidState, notFound } from '../../lib/errors.js';
import { authorizeClientAccess, type Actor } from '../auth/authorize.js';
import { addClientMember } from './service.js';

/**
 * Managers may change membership ONLY on clients they own, and cannot escalate:
 * - they can add employees/managers as 'collaborator' — never 'owner' (ownership = control);
 * - they cannot add admins (admins already see everything; nothing to grant);
 * - they cannot remove an owner (including taking over by removing the existing owner).
 * Admins can do all of the above.
 */
export function addMemberAsActor(
  exec: Executor,
  actor: Actor,
  clientId: string,
  input: { userId: string; membershipRole: ClientMember['membershipRole'] },
): ClientMember {
  return withTransaction(exec, (tx) => {
    const { client } = authorizeClientAccess(tx, actor, clientId, 'client:manageMembers');
    // Archived clients are read-only, staff included (same rule as details and contacts).
    if (client.archivedAt) throw invalidState('Client is archived');
    const target = findUserById(tx, input.userId);
    if (!target || !target.isActive) throw notFound('User');
    if (actor.role !== 'admin') {
      if (input.membershipRole !== 'collaborator' || target.role === 'admin') throw forbidden();
    }
    if (findMembership(tx, clientId, target.id)) {
      throw new AppError(409, 'ALREADY_MEMBER', 'User is already a member of this client');
    }
    return addClientMember(
      tx,
      { clientId, userId: target.id, membershipRole: input.membershipRole },
      actor.id,
    );
  });
}

export function removeMemberAsActor(
  exec: Executor,
  actor: Actor,
  clientId: string,
  userId: string,
): void {
  withTransaction(exec, (tx) => {
    const { client } = authorizeClientAccess(tx, actor, clientId, 'client:manageMembers');
    // Archived clients are read-only, staff included (same rule as details and contacts).
    if (client.archivedAt) throw invalidState('Client is archived');
    const membership = findMembership(tx, clientId, userId);
    if (!membership) throw notFound('Member');
    if (actor.role !== 'admin' && membership.membershipRole === 'owner') throw forbidden();
    tx.delete(clientMembers)
      .where(and(eq(clientMembers.clientId, clientId), eq(clientMembers.userId, userId)))
      .run();
    recordAudit(tx, {
      actorUserId: actor.id,
      clientId,
      entityType: 'client_member',
      entityId: `${clientId}:${userId}`,
      action: 'delete',
      before: { membershipRole: membership.membershipRole },
    });
  });
}
