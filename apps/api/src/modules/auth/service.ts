import { recordAudit } from '../../db/repositories/audit.js';
import {
  deleteDeadSessions,
  findSessionWithUser,
  hashToken,
  insertSession,
  newSessionToken,
  revokeSession,
  touchSession,
} from '../../db/repositories/sessions.js';
import { findUserByEmail, findUserById } from '../../db/repositories/users.js';
import type { User } from '../../db/schema.js';
import { withTransaction, type Executor } from '../../db/tx.js';
import { AppError } from '../../lib/errors.js';
import { nowIso } from '../../lib/normalize.js';
import { dummyVerify, isPasswordHash, verifyPassword } from '../../lib/password.js';
import type { Actor } from './authorize.js';

export interface SessionPolicy {
  ttlMs: number;
  idleMs: number;
}

/** Only bump last_seen_at this often, so reads don't each cost a write. */
const TOUCH_INTERVAL_MS = 60_000;

export const invalidCredentials = () =>
  // Same response for unknown email, wrong password and disabled account.
  new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');

export const unauthenticated = () =>
  new AppError(401, 'UNAUTHENTICATED', 'Authentication required');

export interface LoginResult {
  token: string;
  user: User;
  expiresAt: string;
}

/**
 * Verifies credentials in roughly constant time and creates a NEW session (fresh token on every
 * login → no session fixation). `previousToken`, if presented, is revoked.
 */
export async function login(
  exec: Executor,
  input: { email: string; password: string; previousToken?: string | null },
  policy: SessionPolicy,
): Promise<LoginResult> {
  const user = findUserByEmail(exec, input.email);
  // Always spend one Argon2id derivation — unknown emails and placeholder hashes ('!unusable',
  // demo users) included — and check is_active only afterwards, so timing reveals nothing.
  const ok =
    user && isPasswordHash(user.passwordHash)
      ? await verifyPassword(input.password, user.passwordHash)
      : await dummyVerify(input.password);

  if (!user || !ok || !user.isActive) {
    if (user) {
      recordAudit(exec, {
        actorUserId: null,
        clientId: null,
        entityType: 'user',
        entityId: user.id,
        action: user.isActive ? 'auth.login_failed' : 'auth.login_inactive',
      });
    }
    throw invalidCredentials();
  }

  // Everything after the (async) hash check is one synchronous transaction.
  return withTransaction(exec, (tx) => {
    // Re-check inside the transaction: the account may have been disabled, or its role or
    // password changed, while the hash was being computed.
    const current = findUserById(tx, user.id);
    if (!current?.isActive || current.passwordHash !== user.passwordHash) {
      throw invalidCredentials();
    }
    return startSession(tx, current, policy, input.previousToken ?? null, 'auth.login');
  });
}

/**
 * Issues a NEW session for an already-verified, active user (login and instant self-signup).
 * Must run inside the caller's transaction. Revokes the presented previous token (no fixation).
 */
export function startSession(
  tx: Executor,
  user: User,
  policy: SessionPolicy,
  previousToken: string | null,
  auditAction: 'auth.login' | 'auth.signup_login',
): LoginResult {
  const now = Date.now();
  const at = new Date(now).toISOString();
  if (previousToken) {
    const prev = findSessionWithUser(tx, hashToken(previousToken));
    if (prev) revokeSession(tx, prev.session.id, at);
  }
  const { token, tokenHash } = newSessionToken();
  const expiresAt = new Date(now + policy.ttlMs).toISOString();
  insertSession(tx, { userId: user.id, tokenHash, expiresAt, lastSeenAt: at });
  recordAudit(tx, {
    actorUserId: user.id,
    clientId: null,
    entityType: 'user',
    entityId: user.id,
    action: auditAction,
  });
  // Housekeeping: dead sessions older than a week.
  deleteDeadSessions(tx, new Date(now - 7 * 86_400_000).toISOString());
  return { token, user, expiresAt };
}

/**
 * Resolves a cookie token to an Actor, or null. Rejects revoked, expired (absolute or idle)
 * sessions and DISABLED users — checked on every request, so disabling takes effect at once.
 */
export function authenticate(
  exec: Executor,
  token: string,
  policy: SessionPolicy,
): { actor: Actor; expiresAt: string } | null {
  const found = findSessionWithUser(exec, hashToken(token));
  if (!found) return null;
  const { session, user } = found;
  const now = Date.now();
  const at = new Date(now).toISOString();

  if (session.revokedAt) return null;
  if (!user.isActive) return null;
  const lastSeen = Date.parse(session.lastSeenAt ?? session.createdAt);
  if (Date.parse(session.expiresAt) <= now || lastSeen + policy.idleMs <= now) {
    revokeSession(exec, session.id, at);
    return null;
  }
  if (now - lastSeen >= TOUCH_INTERVAL_MS) touchSession(exec, session.id, at);

  return {
    actor: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      sessionId: session.id,
    },
    expiresAt: session.expiresAt,
  };
}

export function logout(exec: Executor, actor: Actor): void {
  withTransaction(exec, (tx) => {
    revokeSession(tx, actor.sessionId, nowIso());
    recordAudit(tx, {
      actorUserId: actor.id,
      clientId: null,
      entityType: 'user',
      entityId: actor.id,
      action: 'auth.logout',
    });
  });
}
