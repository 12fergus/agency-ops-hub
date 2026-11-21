import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { sessions, users, type Session, type User } from '../schema.js';
import type { Executor } from '../tx.js';

/** 256-bit opaque token; only its SHA-256 is stored, so a DB leak doesn't leak sessions. */
export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export const hashToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

export function insertSession(
  exec: Executor,
  values: { userId: string; tokenHash: string; expiresAt: string; lastSeenAt: string },
): Session {
  return exec.insert(sessions).values(values).returning().get();
}

export function findSessionWithUser(
  exec: Executor,
  tokenHash: string,
): { session: Session; user: User } | undefined {
  return exec
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, tokenHash))
    .get();
}

export function touchSession(exec: Executor, id: string, at: string): void {
  exec.update(sessions).set({ lastSeenAt: at }).where(eq(sessions.id, id)).run();
}

export function revokeSession(exec: Executor, id: string, at: string): void {
  exec
    .update(sessions)
    .set({ revokedAt: at })
    .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
    .run();
}

/** Used on disable, role change and (later) password change. Returns sessions revoked. */
export function revokeAllUserSessions(exec: Executor, userId: string, at: string): number {
  return exec
    .update(sessions)
    .set({ revokedAt: at })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .run().changes;
}

/** Housekeeping: drop sessions that expired or were revoked before `before`. */
export function deleteDeadSessions(exec: Executor, before: string): number {
  return exec
    .delete(sessions)
    .where(or(lt(sessions.expiresAt, before), lt(sessions.revokedAt, before)))
    .run().changes;
}
