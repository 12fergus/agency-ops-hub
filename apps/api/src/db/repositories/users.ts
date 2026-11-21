import { and, eq } from 'drizzle-orm';
import { normalizeEmail } from '../../lib/normalize.js';
import { clientMembers, users, type User, type UserRole } from '../schema.js';
import type { Executor } from '../tx.js';

/** Placeholder hash that no password can ever match. Real hashes arrive with the auth phase. */
export const UNUSABLE_PASSWORD_HASH = '!unusable';

export interface CreateUserInput {
  email: string;
  displayName: string;
  role: UserRole;
  passwordHash?: string;
  isActive?: boolean;
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
