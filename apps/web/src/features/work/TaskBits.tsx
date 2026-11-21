import type { StatusColor, TaskDto, TaskStatus } from '@agency-crm/shared';
import { formatDateTime, t } from '@/lib/i18n';
import { ColorBadge } from '@/features/clients/StatusBadge';
import { taskStatusLabel } from './labels';

const TASK_STATUS_COLORS: Record<TaskStatus, StatusColor> = {
  open: 'blue',
  in_progress: 'amber',
  done: 'green',
  cancelled: 'gray',
};

/** Colored status badge; the text is always shown, so color is never the only cue. */
export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <ColorBadge name={taskStatusLabel(status)} color={TASK_STATUS_COLORS[status]} />;
}

/** Deadline with an explicit "באיחור" marker (text + color) when overdue. */
export function DueDate({ task }: { task: Pick<TaskDto, 'dueAt' | 'overdue'> }) {
  if (!task.dueAt) return <span className="text-slate-500">{t('tasks.noDue')}</span>;
  return (
    <span className={task.overdue ? 'font-medium text-red-700' : undefined}>
      <span dir="ltr">{formatDateTime(task.dueAt)}</span>
      {task.overdue && (
        <span className="ms-2 rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-800 ring-1 ring-red-200">
          {t('tasks.overdue')}
        </span>
      )}
    </span>
  );
}
