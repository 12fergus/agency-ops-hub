import type { SignupInput, UserDto, UserRole, UserStatus } from '@agency-crm/shared';
import { recordAudit } from '../../db/repositories/audit.js';
import { revokeAllUserSessions } from '../../db/repositories/sessions.js';
import {
  countLoginCapableAdmins,
  createUser,
  findUserByEmail,
  findUserById,
  listUsers,
  updateUser,
} from '../../db/repositories/users.js';
import type { User } from '../../db/schema.js';
import { withTransaction, type Executor } from '../../db/tx.js';
import { AppError, notFound, validation } from '../../lib/errors.js';
import { nowIso } from '../../lib/normalize.js';
import { checkPasswordPolicy, hashPassword, isPasswordHash } from '../../lib/password.js';
import { requireRole, type Actor } from '../auth/authorize.js';
import { startSession, type LoginResult, type SessionPolicy } from '../auth/service.js';

export function userStatus(u: Pick<User, 'isActive' | 'approvedAt'>): UserStatus {
  if (u.isActive) return 'active';
  return u.approvedAt === null ? 'pending' : 'disabled';
}

export function toUserDto(u: User): UserDto {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    isActive: u.isActive,
    status: userStatus(u),
    createdAt: u.createdAt,
  };
}

const conflict = (code: string, message: string) => new AppError(409, code, message);

/** Only admins who can log in are protected by the "last admin" rule (see countLoginCapableAdmins). */
const isLoginCapableAdmin = (u: User) =>
  u.role === 'admin' && u.isActive && isPasswordHash(u.passwordHash);

export function listUsersAsAdmin(exec: Executor, actor: Actor): UserDto[] {
  requireRole(actor, 'admin');
  return listUsers(exec).map(toUserDto);
}

/** Shared by the admin API and the first-admin bootstrap CLI. Password hashed with Argon2id. */
export async function createUserWithPassword(
  exec: Executor,
  input: { email: string; displayName: string; role: UserRole; password: string },
  actorUserId: string | null,
): Promise<User> {
  const policy = checkPasswordPolicy(input.password, input.email);
  if (policy) throw validation(policy);
  if (findUserByEmail(exec, input.email)) throw conflict('EMAIL_TAKEN', 'Email already in use');
  const passwordHash = await hashPassword(input.password);

  return withTransaction(exec, (tx) => {
    const user = createUser(tx, { ...input, passwordHash });
    recordAudit(tx, {
      actorUserId,
      clientId: null,
      entityType: 'user',
      entityId: user.id,
      action: 'user.create',
      after: { role: user.role, isActive: user.isActive },
    });
    return user;
  });
}

export type SignupResult = { status: 'pending' } | { status: 'active'; session: LoginResult };

/**
 * Self-signup from the login page. Always an EMPLOYEE with NO client memberships, so the account
 * can see no client data until an admin assigns it (authorization is membership-based).
 *
 * - Default (instant): the account is active and a session is started → the user lands logged in.
 *   An existing email is rejected with 409 EMAIL_TAKEN (we can't log them in; on an internal
 *   LAN the existence leak is accepted — ADR-016).
 * - SIGNUP_REQUIRES_APPROVAL=true: the account is PENDING (inactive, unapproved) until an admin
 *   approves it; an existing email gets the identical "pending" answer (no enumeration).
 * A password hash is computed in every case, so timing doesn't reveal existing emails.
 */
export async function signup(
  exec: Executor,
  input: SignupInput & { previousToken?: string | null },
  opts: { requiresApproval: boolean; session: SessionPolicy },
): Promise<SignupResult> {
  const policy = checkPasswordPolicy(input.password, input.email);
  if (policy) throw validation(policy);
  const passwordHash = await hashPassword(input.password);

  return withTransaction(exec, (tx): SignupResult => {
    if (findUserByEmail(tx, input.email)) {
      if (opts.requiresApproval) return { status: 'pending' };
      throw conflict('EMAIL_TAKEN', 'Email already in use');
    }
    const user = createUser(tx, {
      email: input.email,
      displayName: input.displayName,
      role: 'employee',
      passwordHash,
      isActive: !opts.requiresApproval,
      approvedAt: opts.requiresApproval ? null : nowIso(),
    });
    recordAudit(tx, {
      actorUserId: null,
      clientId: null,
      entityType: 'user',
      entityId: user.id,
      action: 'user.signup',
      after: { role: user.role, status: userStatus(user) },
    });
    if (opts.requiresApproval) return { status: 'pending' };
    return {
      status: 'active',
      session: startSession(
        tx,
        user,
        opts.session,
        input.previousToken ?? null,
        'auth.signup_login',
      ),
    };
  });
}

export class BootstrapRefusedError extends Error {}

/**
 * First-admin bootstrap (host CLI only — there is deliberately no HTTP route for this).
 * Refuses once any active admin exists, so it can't be used to mint extra admins later.
 */
export async function bootstrapFirstAdmin(
  exec: Executor,
  input: { email: string; displayName: string; password: string },
): Promise<UserDto> {
  if (countLoginCapableAdmins(exec) > 0) {
    throw new BootstrapRefusedError(
      'An active admin already exists. Create further users from the admin users page.',
    );
  }
  const user = await createUserWithPassword(exec, { ...input, role: 'admin' }, null);
  return toUserDto(user);
}

export async function createUserAsAdmin(
  exec: Executor,
  actor: Actor,
  input: { email: string; displayName: string; role: UserRole; password: string },
): Promise<UserDto> {
  requireRole(actor, 'admin');
  return toUserDto(await createUserWithPassword(exec, input, actor.id));
}

/** Role change revokes all of the user's sessions (privilege change → re-authenticate). */
export function changeRoleAsAdmin(
  exec: Executor,
  actor: Actor,
  userId: string,
  role: UserRole,
): UserDto {
  requireRole(actor, 'admin');
  return withTransaction(exec, (tx) => {
    const user = findUserById(tx, userId);
    if (!user) throw notFound('User');
    if (user.role === role) return toUserDto(user);
    if (user.id === actor.id) {
      throw conflict('CANNOT_CHANGE_OWN_ROLE', 'Admins cannot change their own role');
    }
    if (isLoginCapableAdmin(user) && countLoginCapableAdmins(tx) <= 1) {
      throw conflict('LAST_ADMIN', 'At least one active admin is required');
    }
    const updated = updateUser(tx, userId, { role })!;
    revokeAllUserSessions(tx, userId, nowIso());
    recordAudit(tx, {
      actorUserId: actor.id,
      clientId: null,
      entityType: 'user',
      entityId: userId,
      action: 'user.change_role',
      before: { role: user.role },
      after: { role },
    });
    return toUserDto(updated);
  });
}

/** Disabling revokes all sessions; the per-request is_active check makes it immediate anyway. */
export function setActiveAsAdmin(
  exec: Executor,
  actor: Actor,
  userId: string,
  isActive: boolean,
): UserDto {
  requireRole(actor, 'admin');
  return withTransaction(exec, (tx) => {
    const user = findUserById(tx, userId);
    if (!user) throw notFound('User');
    if (user.isActive === isActive) return toUserDto(user);
    if (!isActive) {
      if (user.id === actor.id) {
        throw conflict('CANNOT_DISABLE_SELF', 'Admins cannot disable their own account');
      }
      if (isLoginCapableAdmin(user) && countLoginCapableAdmins(tx) <= 1) {
        throw conflict('LAST_ADMIN', 'At least one active admin is required');
      }
    }
    // Enabling a pending self-signup IS the approval.
    const approving = isActive && user.approvedAt === null;
    const updated = updateUser(tx, userId, {
      isActive,
      ...(approving ? { approvedAt: nowIso() } : {}),
    })!;
    if (!isActive) revokeAllUserSessions(tx, userId, nowIso());
    recordAudit(tx, {
      actorUserId: actor.id,
      clientId: null,
      entityType: 'user',
      entityId: userId,
      action: approving ? 'user.approve' : isActive ? 'user.enable' : 'user.disable',
      before: { status: userStatus(user) },
      after: { status: userStatus(updated) },
    });
    return toUserDto(updated);
  });
}
