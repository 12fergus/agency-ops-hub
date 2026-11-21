import { z } from 'zod';
import { PASSWORD_MAX_LENGTH } from './password-policy.js';

export const USER_ROLES = ['admin', 'manager', 'employee'] as const;
export type UserRole = (typeof USER_ROLES)[number];

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const loginSchema = z.object({
  email,
  // Length-capped so a huge body can't make hashing expensive; policy checked only on set.
  password: z.string().min(1).max(256),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** active = can log in; pending = self-signup awaiting admin approval; disabled = turned off. */
export const USER_STATUSES = ['active', 'pending', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Public view of a user. Never includes the password hash. */
export const userDtoSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: z.enum(USER_ROLES),
  isActive: z.boolean(),
  status: z.enum(USER_STATUSES),
  createdAt: z.string(),
});
export type UserDto = z.infer<typeof userDtoSchema>;

/** Self-signup: always creates a PENDING employee; an admin must approve it. */
export const signupSchema = z.object({
  email,
  displayName: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type SignupInput = z.infer<typeof signupSchema>;

/** First-run setup: the one-time code from the server's data folder + the first admin's details. */
export const setupSchema = z.object({
  code: z.string().trim().min(1).max(40),
  email,
  displayName: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type SetupInput = z.infer<typeof setupSchema>;

export const createUserSchema = z.object({
  email,
  displayName: z.string().trim().min(1).max(100),
  role: z.enum(USER_ROLES),
  // Only bounds here; the real rules live in password-policy.ts so the API can name the exact
  // broken rule (e.g. PASSWORD_NEEDS_SYMBOL) instead of a generic validation error.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const changeRoleSchema = z.object({ role: z.enum(USER_ROLES) });

export const MEMBERSHIP_ROLES = ['owner', 'collaborator'] as const;
export const addMemberSchema = z.object({
  userId: z.string().min(1).max(64),
  membershipRole: z.enum(MEMBERSHIP_ROLES).default('collaborator'),
});

export const idParamSchema = z.object({ id: z.string().min(1).max(64) });
