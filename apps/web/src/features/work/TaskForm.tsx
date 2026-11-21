import { useState, type FormEvent } from 'react';
import {
  TASK_STATUSES,
  taskInputSchema,
  type CommunicationDto,
  type TaskDto,
  type TaskStatus,
  type UserDto,
} from '@agency-crm/shared';
import { Field } from '@/components/Field';
import { ApiRequestError, errorMessage } from '@/lib/api';
import { fromLocalInput, toLocalInput } from '@/lib/datetime';
import { fieldErrors, serverFieldErrors } from '@/lib/formErrors';
import { formatDateTime, t, tf } from '@/lib/i18n';
import { useStaff } from '@/features/clients/api';
import { useSaveTask } from './api';
import { commTypeLabel, createdFromText, taskStatusLabel } from './labels';

/**
 * Create / edit a task. With `fromCommunication` it is a follow-up task ("צור משימת המשך"): the
 * record is shown as context and the new task stays linked to it.
 */
export function TaskForm({
  clientId,
  actor,
  task,
  fromCommunication,
  onSaved,
}: {
  clientId: string;
  actor: UserDto;
  task?: TaskDto;
  fromCommunication?: CommunicationDto;
  onSaved: () => void;
}) {
  const staff = useStaff(clientId);
  const save = useSaveTask();
  const readOnly = task ? !task.canEdit : false;

  // Who can be assigned: active staff of the client, plus the admin themself (admins have
  // access without membership), plus the current assignee so an edit never silently changes it.
  const options = new Map<string, string>();
  for (const m of staff.data ?? []) if (m.isActive) options.set(m.userId, m.displayName);
  if (actor.role === 'admin' && !options.has(actor.id)) options.set(actor.id, actor.displayName);
  if (task && !options.has(task.assignee.id)) {
    options.set(task.assignee.id, task.assignee.displayName);
  }
  const defaultAssignee = task?.assignee.id ?? (options.has(actor.id) ? actor.id : '');

  const [values, setValues] = useState({
    title: task?.title ?? '',
    description: task?.description ?? '',
    assignedUserId: defaultAssignee,
    dueAt: task?.dueAt ? toLocalInput(task.dueAt) : '',
    status: (task?.status ?? 'open') as TaskStatus,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (key: keyof typeof values) => (value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors(({ [key]: _, ...rest }) => rest);
  };
  const assignedUserId = values.assignedUserId || defaultAssignee;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const dueAt = values.dueAt ? fromLocalInput(values.dueAt) : null;
    const input = {
      clientId,
      title: values.title,
      description: values.description,
      assignedUserId,
      dueAt,
      ...(fromCommunication ? { communicationId: fromCommunication.id } : {}),
    };
    const found = fieldErrors(taskInputSchema, input);
    if (values.dueAt && !dueAt) found.dueAt = t('form.invalid');
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const onError = (err: unknown) => {
      if (err instanceof ApiRequestError && err.code === 'VALIDATION') {
        setErrors(serverFieldErrors(err.details));
      }
    };
    if (task) {
      save.mutate(
        {
          id: task.id,
          patch: {
            title: values.title,
            description: values.description,
            assignedUserId,
            dueAt,
            status: values.status,
          },
        },
        { onSuccess: onSaved, onError },
      );
    } else {
      save.mutate({ input }, { onSuccess: onSaved, onError });
    }
  };

  const hasErrors = Object.keys(errors).length > 0;
  const source = fromCommunication
    ? {
        type: fromCommunication.type,
        occurredAt: fromCommunication.occurredAt,
        summary: fromCommunication.summary,
      }
    : null;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {source && (
        <figure className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
          <figcaption className="mb-1 font-medium">
            {t('tasks.context')}: {commTypeLabel(source.type)}{' '}
            <span dir="ltr">{formatDateTime(source.occurredAt)}</span>
          </figcaption>
          <blockquote className="line-clamp-4 whitespace-pre-wrap text-slate-700">
            {source.summary}
          </blockquote>
        </figure>
      )}
      {task?.communication && (
        <p className="text-sm text-slate-600">{createdFromText(task.communication)}</p>
      )}
      {task?.createdBy && (
        <p className="text-sm text-slate-600">
          {tf('tasks.createdBy', { name: task.createdBy.displayName })}
        </p>
      )}
      {readOnly && (
        <p role="note" className="rounded-md bg-slate-100 p-2 text-sm text-slate-700">
          {t('tasks.archivedClient')}
        </p>
      )}

      <fieldset disabled={readOnly} className="space-y-4">
        <Field
          id="task-title"
          label={t('tasks.field.title')}
          value={values.title}
          maxLength={200}
          required
          error={errors.title ?? null}
          onChange={(e) => set('title')(e.target.value)}
        />

        <div>
          <label htmlFor="task-description" className="mb-1 block text-sm font-medium">
            {t('tasks.field.description')}
          </label>
          <textarea
            id="task-description"
            rows={3}
            maxLength={5000}
            value={values.description}
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={errors.description ? 'task-description-error' : undefined}
            onChange={(e) => set('description')(e.target.value)}
            className={`w-full rounded-md border px-3 py-2 ${errors.description ? 'border-red-600 bg-red-50' : 'border-slate-300'}`}
          />
          {errors.description && (
            <p id="task-description-error" className="mt-1 text-sm text-red-700">
              {errors.description}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="task-assignee" className="mb-1 block text-sm font-medium">
            {t('tasks.field.assignee')}
          </label>
          <select
            id="task-assignee"
            value={assignedUserId}
            required
            aria-invalid={errors.assignedUserId ? true : undefined}
            aria-describedby={errors.assignedUserId ? 'task-assignee-error' : undefined}
            onChange={(e) => set('assignedUserId')(e.target.value)}
            className={`w-full rounded-md border px-3 py-2 ${errors.assignedUserId ? 'border-red-600 bg-red-50' : 'border-slate-300'}`}
          >
            {!assignedUserId && <option value="">{t('common.none')}</option>}
            {[...options].map(([id, name]) => (
              <option key={id} value={id}>
                {id === actor.id ? tf('tasks.me', { name }) : name}
              </option>
            ))}
          </select>
          {errors.assignedUserId && (
            <p id="task-assignee-error" className="mt-1 text-sm text-red-700">
              {errors.assignedUserId}
            </p>
          )}
        </div>

        <Field
          id="task-due"
          type="datetime-local"
          label={t('tasks.field.dueAt')}
          value={values.dueAt}
          error={errors.dueAt ?? null}
          onChange={(e) => set('dueAt')(e.target.value)}
          dir="ltr"
        />

        {task && (
          <div>
            <label htmlFor="task-status" className="mb-1 block text-sm font-medium">
              {t('tasks.field.status')}
            </label>
            <select
              id="task-status"
              value={values.status}
              onChange={(e) => set('status')(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            >
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {taskStatusLabel(s)}
                </option>
              ))}
            </select>
          </div>
        )}

        {(hasErrors || save.isError) && (
          <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-700">
            {hasErrors ? t('form.fixErrors') : errorMessage(save.error)}
          </p>
        )}

        <button
          type="submit"
          disabled={save.isPending}
          className="rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:opacity-50"
        >
          {save.isPending ? t('common.loading') : t('common.save')}
        </button>
      </fieldset>
    </form>
  );
}
