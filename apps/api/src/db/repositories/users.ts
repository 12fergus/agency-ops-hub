import { and, asc, count, eq, like } from 'drizzle-orm';
import { normalizeEmail, nowIso } from '../../lib/normalize.js';
import { clientMembers, users, type ClientMember, type User, type UserRole } from '../schema.js';
import type { Executor } from '../tx.js';

/** Placeholder hash that no password can ever match (demo users, accounts without a password). */
export const UNUSABLE_PASSWORD_HASH = '!unusable';

export interface CreateUserInput {
  email: string;
  displayName: string;
  role: UserRole;
  passwordHash?: string;
  isActive?: boolean;
  /** Default: approved now (admin-created). Pass null for a pending self-signup. */
  approvedAt?: string | null;
}

export function createUser(exec: Executor, input: CreateUserInput): User {
  const email = normalizeEmail(input.email);
  if (!email) throw new Error('email is required');
  return exec
    .insert(users)
    .values({
      email,
      displayName: input.displayName.trim(),
      role: input.role,
      passwordHash: input.passwordHash ?? UNUSABLE_PASSWORD_HASH,
      isActive: input.isActive ?? true,
      approvedAt: input.approvedAt === undefined ? nowIso() : input.approvedAt,
    })
    .returning()
    .get();
}

export function findUserById(exec: Executor, id: string): User | undefined {
  return exec.select().from(users).where(eq(users.id, id)).get();
}

export function findUserByEmail(exec: Executor, email: string): User | undefined {
  const normalized = normalizeEmail(email);
  return normalized
    ? exec.select().from(users).where(eq(users.email, normalized)).get()
    : undefined;
}

export function listUsers(exec: Executor): User[] {
  return exec.select().from(users).orderBy(asc(users.displayName)).all();
}

export function updateUser(
  exec: Executor,
  id: string,
  values: Partial<Pick<User, 'role' | 'isActive' | 'passwordHash' | 'displayName' | 'approvedAt'>>,
): User | undefined {
  return exec.update(users).set(values).where(eq(users.id, id)).returning().get();
}

/**
 * Admins who can actually LOG IN: active and holding a real Argon2id hash. Demo/placeholder
 * admins ('!unusable') don't count — otherwise demo data would block the first-admin bootstrap
 * and the "last admin" protection could let the only real admin be demoted (lockout).
 */
export function countLoginCapableAdmins(exec: Executor): number {
  return (
    exec
      .select({ n: count() })
      .from(users)
      .where(
        and(
          eq(users.role, 'admin'),
          eq(users.isActive, true),
          like(users.passwordHash, '$argon2id$%'),
        ),
      )
      .get()?.n ?? 0
  );
}

export function findMembership(
  exec: Executor,
  clientId: string,
  userId: string,
): ClientMember | undefined {
  return exec
    .select()
    .from(clientMembers)
    .where(and(eq(clientMembers.clientId, clientId), eq(clientMembers.userId, userId)))
    .get();
}

export function isClientMember(exec: Executor, clientId: string, userId: string): boolean {
  return (
    exec
      .select({ userId: clientMembers.userId })
      .from(clientMembers)
      .where(and(eq(clientMembers.clientId, clientId), eq(clientMembers.userId, userId)))
      .get() !== undefined
  );
}

/** Active admins see every client; everyone else needs a membership row. */
export function userCanAccessClient(exec: Executor, userId: string, clientId: string): boolean {
  const user = findUserById(exec, userId);
  if (!user || !user.isActive) return false;
  return user.role === 'admin' || isClientMember(exec, clientId, userId);
}
