import { z } from 'zod';
import { MAX_PAGE_SIZE } from './api.js';

/**
 * Lifecycle only: archived or not (set via the archive endpoint, admin). The business status
 * the team works with (פעיל, לא פעיל, …) is the admin-defined `clientStatus` (ADR-019).
 */
export const CLIENT_STATUSES = ['active', 'archived'] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

/** Fixed color palette for statuses (mapped to vetted classes in the UI). */
export const STATUS_COLORS = [
  'green',
  'gray',
  'amber',
  'blue',
  'red',
  'purple',
  'teal',
  'pink',
] as const;
export type StatusColor = (typeof STATUS_COLORS)[number];

export interface ClientStatusDto {
  id: string;
  name: string;
  color: StatusColor;
  position: number;
  isDefault: boolean;
  /**
   * How many clients (incl. archived) use it — a status in use can't be deleted. ADMINS ONLY:
   * null for everyone else (counts span clients a user may not see).
   */
  clientCount: number | null;
}

export const clientStatusInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.enum(STATUS_COLORS),
});
export const clientStatusPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    color: z.enum(STATUS_COLORS),
    isDefault: z.literal(true),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'EMPTY_PATCH' });
export const statusReorderSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(100),
});

/** Server-side sort allowlist: the only values `sort` may take. */
export const CLIENT_SORT_FIELDS = [
  'name',
  'businessName',
  'status',
  'updatedAt',
  'createdAt',
] as const;
export type ClientSortField = (typeof CLIENT_SORT_FIELDS)[number];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

/** Digits plus the usual separators; real normalization happens only for matching. */
const phone = z
  .string()
  .trim()
  .max(40)
  .regex(/^[+]?[\d\s().-]*$/, 'PHONE_INVALID')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .transform((v) => (v === '' ? null : v))
  .pipe(z.email().nullable())
  .nullable()
  .optional();

/**
 * Field rules WITHOUT defaults. Defaults belong only to "create": Zod keeps a field's default
 * through .partial(), so a PATCH schema built from the create schema would silently reset
 * omitted fields (e.g. a paused client back to active).
 */
const clientFields = z.object({
  name: z.string().trim().min(1).max(120),
  businessName: optionalText(160),
  industry: optionalText(80),
  phone,
  email,
  notes: optionalText(5000),
  /** Admin-defined status id; omitted on create → the default status. */
  statusId: z.string().min(1).max(64),
});

export const clientInputSchema = clientFields.extend({
  statusId: z.string().min(1).max(64).optional(),
});
export type ClientInput = z.input<typeof clientInputSchema>;

/** PATCH: any non-empty subset; omitted fields stay unchanged. */
export const clientPatchSchema = clientFields
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'EMPTY_PATCH' });

export const clientListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
  q: z.string().trim().max(100).optional(),
  /** Lifecycle filter. Default excludes archived clients. */
  status: z.enum(['current', 'archived', 'all']).default('current'),
  /** Admin-defined status filter. */
  statusId: z.string().min(1).max(64).optional(),
  ownerId: z.string().min(1).max(64).optional(),
  sort: z.enum(CLIENT_SORT_FIELDS).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
});
export type ClientListQuery = z.input<typeof clientListQuerySchema>;

export interface ClientStaffMember {
  userId: string;
  displayName: string;
  email: string;
  role: 'admin' | 'manager' | 'employee';
  isActive: boolean;
  membershipRole: 'owner' | 'collaborator';
}

/** What the current user may do with this client (computed by the server). */
export interface ClientPermissions {
  canEdit: boolean;
  canManageStaff: boolean;
  canManageContacts: boolean;
  canArchive: boolean;
}

export interface ClientDto {
  id: string;
  name: string;
  businessName: string | null;
  status: ClientStatus;
  industry: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  clientStatus: { id: string; name: string; color: StatusColor } | null;
  /** Same-origin URL of the photo/logo (session-protected), or null. */
  photoUrl: string | null;
  owners: { userId: string; displayName: string }[];
  memberCount: number;
  permissions: ClientPermissions;
}

export interface ClientListMeta {
  page: number;
  pageSize: number;
  total: number;
}

const contactFields = z.object({
  name: z.string().trim().min(1).max(120),
  title: optionalText(80),
  phone,
  email,
  isPrimary: z.boolean(),
});
export const contactInputSchema = contactFields.extend({ isPrimary: z.boolean().default(false) });
export type ContactInput = z.input<typeof contactInputSchema>;
/** PATCH without defaults (see clientFields): omitting isPrimary keeps the current value. */
export const contactPatchSchema = contactFields
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'EMPTY_PATCH' });

export interface ContactDto {
  id: string;
  clientId: string;
  name: string;
  title: string | null;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
}

/** Users that can be assigned to clients (active, non-admin) — for the staff picker. */
export interface AssignableUser {
  id: string;
  displayName: string;
  email: string;
  role: 'manager' | 'employee';
}

/** Client photo/logo upload rules (enforced server-side by content sniffing, not the filename). */
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
