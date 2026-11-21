import type { CommunicationType, TaskDto, TaskStatus } from '@agency-crm/shared';
import { formatDateTime, t, tf, type MessageKey } from '@/lib/i18n';

export const taskStatusLabel = (s: TaskStatus) => t(`tasks.status.${s}` as MessageKey);
export const commTypeLabel = (c: CommunicationType) => t(`comms.type.${c}` as MessageKey);

/** Isolates a date/time as left-to-right inside Hebrew text (LRI … PDI). */
const ltr = (v: string) => `⁦${v}⁩`;

/** "נוצרה מתוך: שיחה מ־23.11.2026 10:00" */
export function createdFromText(c: NonNullable<TaskDto['communication']>): string {
  return tf('tasks.createdFrom', {
    type: commTypeLabel(c.type),
    date: ltr(formatDateTime(c.occurredAt)),
  });
}
