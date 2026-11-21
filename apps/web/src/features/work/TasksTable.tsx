import { useState } from 'react';
import { TASK_STATUSES, type TaskDto, type TaskListQuery, type UserDto } from '@agency-crm/shared';
import { Drawer } from '@/components/Drawer';
import { errorMessage } from '@/lib/api';
import { t, tf } from '@/lib/i18n';
import { useSaveTask, useTasks } from './api';
import { createdFromText, taskStatusLabel } from './labels';
import { DueDate } from './TaskBits';
import { TaskForm } from './TaskForm';

/** Server-paginated task list with inline status change and an edit drawer. */
export function TasksTable({
  query,
  actor,
  showClient,
  onOpenClient,
  emptyText,
  onPage,
}: {
  query: TaskListQuery;
  actor: UserDto;
  showClient: boolean;
  onOpenClient?: (clientId: string) => void;
  emptyText: string;
  onPage: (page: number) => void;
}) {
  const tasks = useTasks(query);
  const save = useSaveTask();
  const [editing, setEditing] = useState<TaskDto | null>(null);
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 20);
  const total = tasks.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  if (tasks.isPending) return <p role="status">{t('common.loading')}</p>;
  if (tasks.isError) {
    return (
      <p role="alert" className="text-red-700">
        {errorMessage(tasks.error)}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {tasks.data.rows.length === 0 ? (
        <p className="text-slate-500">{emptyText}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-start text-slate-600">
              <tr>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {t('tasks.col.title')}
                </th>
                {showClient && (
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {t('tasks.col.client')}
                  </th>
                )}
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {t('tasks.col.assignee')}
                </th>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {t('tasks.col.dueAt')}
                </th>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {t('tasks.col.status')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tasks.data.rows.map((task) => (
                <tr key={task.id} className={task.overdue ? 'bg-red-50/40' : undefined}>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => setEditing(task)}
                      aria-label={tf('tasks.open', { title: task.title })}
                      className="text-start font-medium text-blue-800 underline"
                    >
                      {task.title}
                    </button>
                    {task.communication && (
                      <p className="text-xs text-slate-500">
                        {createdFromText(task.communication)}
                      </p>
                    )}
                  </td>
                  {showClient && (
                    <td className="px-2 py-2">
                      {onOpenClient ? (
                        <a
                          href={`#/clients/${encodeURIComponent(task.client.id)}`}
                          onClick={(e) => {
                            e.preventDefault();
                            onOpenClient(task.client.id);
                          }}
                          className="underline"
                        >
                          {task.client.name}
                        </a>
                      ) : (
                        task.client.name
                      )}
                    </td>
                  )}
                  <td className="px-2 py-2">
                    {task.assignee.id === actor.id
                      ? tf('tasks.me', { name: task.assignee.displayName })
                      : task.assignee.displayName}
                  </td>
                  <td className="px-2 py-2">
                    <DueDate task={task} />
                  </td>
                  <td className="px-2 py-2">
                    {/* Inline status change; the label names the task for screen readers. */}
                    <select
                      aria-label={tf('tasks.statusFor', { title: task.title })}
                      value={task.status}
                      disabled={!task.canEdit || save.isPending}
                      onChange={(e) =>
                        save.mutate({
                          id: task.id,
                          patch: { status: e.target.value as TaskDto['status'] },
                        })
                      }
                      className="rounded-md border border-slate-300 px-2 py-1"
                    >
                      {TASK_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {taskStatusLabel(s)}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {save.isError && (
        <p role="alert" className="text-sm text-red-700">
          {errorMessage(save.error)}
        </p>
      )}

      {total > pageSize && (
        <nav aria-label={t('tasks.pagination')} className="flex items-center gap-2 text-sm">
          <span>{tf('tasks.pageOf', { total, page, pages })}</span>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
            className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40"
          >
            {t('tasks.prevPage')}
          </button>
          <button
            type="button"
            disabled={page >= pages}
            onClick={() => onPage(page + 1)}
            className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40"
          >
            {t('tasks.nextPage')}
          </button>
        </nav>
      )}

      <Drawer open={editing !== null} title={t('tasks.editTitle')} onClose={() => setEditing(null)}>
        {editing && (
          <TaskForm
            key={editing.id}
            clientId={editing.client.id}
            actor={actor}
            task={editing}
            onSaved={() => setEditing(null)}
          />
        )}
      </Drawer>
    </div>
  );
}
