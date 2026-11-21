import { z } from 'zod';
import { MAX_PAGE_SIZE } from './api.js';

/** ISO-8601 with an explicit offset or Z (the server stores UTC). */
const timestamp = z.iso.datetime({ offset: true });
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

// ---------- communication log ----------

export const COMMUNICATION_TYPES = ['call', 'whatsapp', 'meeting', 'email', 'note'] as const;
export type CommunicationType = (typeof COMMUNICATION_TYPES)[number];

const communicationFields = z.object({
  type: z.enum(COMMUNICATION_TYPES),
  occurredAt: timestamp,
  summary: z.string().trim().min(1).max(5000),
  contactId: z.string().min(1).max(64).nullable().optional(),
});
export const communicationInputSchema = communicationFields;
export type CommunicationInput = z.input<typeof communicationInputSchema>;
/** PATCH: defaults-free partial (ADR-018), at least one field. */
export const communicationPatchSchema = communicationFields
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'EMPTY_PATCH' });

export const communicationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

export interface TaskRef {
  id: string;
  title: string;
  status: TaskStatus;
  assignee: { id: string; displayName: string };
  dueAt: string | null;
  overdue: boolean;
}

export interface CommunicationDto {
  id: string;
  clientId: string;
  type: CommunicationType;
  occurredAt: string;
  summary: string;
  contact: { id: string; name: string } | null;
  author: { id: string; displayName: string };
  /** Follow-up tasks created from this record. */
  tasks: TaskRef[];
  createdAt: string;
  updatedAt: string;
  /** Author or admin, and the client isn't archived. */
  canEdit: boolean;
}

// ---------- tasks ----------

/** Fixed workflow (ADR-020): פתוחה → בטיפול → הושלמה, or בוטלה. Never deleted. */
export const TASK_STATUSES = ['open', 'in_progress', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
/** Statuses that still need work (count for "overdue"). */
export const ACTIVE_TASK_STATUSES = ['open', 'in_progress'] as const satisfies TaskStatus[];

const taskFields = z.object({
  title: z.string().trim().min(1).max(200),
  description: optionalText(5000),
  assignedUserId: z.string().min(1).max(64),
  dueAt: timestamp.nullable().optional(),
});
export const taskInputSchema = taskFields.extend({
  clientId: z.string().min(1).max(64),
  /** The communication record this follow-up task comes from (same client). */
  communicationId: z.string().min(1).max(64).nullable().optional(),
});
export type TaskInput = z.input<typeof taskInputSchema>;
export const taskPatchSchema = taskFields
  .extend({ status: z.enum(TASK_STATUSES) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'EMPTY_PATCH' });
export type TaskPatch = z.input<typeof taskPatchSchema>;

/** `active` = open + in_progress (default). */
export const TASK_STATUS_FILTERS = ['active', 'done', 'cancelled', 'all'] as const;
export const TASK_SORT_FIELDS = ['dueAt', 'createdAt', 'updatedAt', 'title'] as const;

export const taskListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
  /** `mine` = assigned to me (default); `all` = every task I may see. */
  scope: z.enum(['mine', 'all']).default('mine'),
  status: z.enum(TASK_STATUS_FILTERS).default('active'),
  clientId: z.string().min(1).max(64).optional(),
  assigneeId: z.string().min(1).max(64).optional(),
  overdue: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(TASK_SORT_FIELDS).default('dueAt'),
  dir: z.enum(['asc', 'desc']).default('asc'),
});
export type TaskListQuery = z.input<typeof taskListQuerySchema>;

export interface TaskDto {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  dueAt: string | null;
  /** Server-computed: due in the past and still open / in progress. */
  overdue: boolean;
  completedAt: string | null;
  client: { id: string; name: string; archived: boolean };
  assignee: { id: string; displayName: string };
  createdBy: { id: string; displayName: string } | null;
  /** Where the task came from ("נוצרה מתוך"), if it was created from a communication record. */
  communication: { id: string; type: CommunicationType; occurredAt: string } | null;
  createdAt: string;
  updatedAt: string;
  /** Any member of the (non-archived) client, or an admin. */
  canEdit: boolean;
}
