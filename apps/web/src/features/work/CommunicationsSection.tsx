import { useState, type FormEvent } from 'react';
import {
  COMMUNICATION_TYPES,
  communicationInputSchema,
  type CommunicationDto,
  type UserDto,
} from '@agency-crm/shared';
import { Drawer } from '@/components/Drawer';
import { ApiRequestError, errorMessage } from '@/lib/api';
import { fromLocalInput, nowLocalInput, toLocalInput } from '@/lib/datetime';
import { fieldErrors, serverFieldErrors } from '@/lib/formErrors';
import { formatDateTime, t, tf } from '@/lib/i18n';
import { useContacts } from '@/features/clients/api';
import { COMMS_PAGE_SIZE, useCommunications, useSaveCommunication } from './api';
import { DueDate, TaskStatusBadge } from './TaskBits';
import { commTypeLabel } from './labels';
import { TaskForm } from './TaskForm';

type Editing = { kind: 'new' } | { kind: 'edit'; comm: CommunicationDto };

/** Client communication log: calls, WhatsApp, meetings, emails, notes — newest first. */
export function CommunicationsSection({
  clientId,
  canWrite,
  actor,
}: {
  clientId: string;
  /** Member/admin of a non-archived client. */
  canWrite: boolean;
  actor: UserDto;
}) {
  const [page, setPage] = useState(1);
  const comms = useCommunications(clientId, page);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [followUp, setFollowUp] = useState<CommunicationDto | null>(null);
  const pages = Math.max(1, Math.ceil((comms.data?.total ?? 0) / COMMS_PAGE_SIZE));

  return (
    <section
      aria-labelledby="comms-title"
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 id="comms-title" className="text-lg font-semibold">
          {t('comms.title')}
        </h2>
        {canWrite && (
          <button
            type="button"
            onClick={() => setEditing({ kind: 'new' })}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
          >
            {t('comms.add')}
          </button>
        )}
      </div>

      {comms.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : comms.isError ? (
        <p role="alert" className="text-red-700">
          {errorMessage(comms.error)}
        </p>
      ) : comms.data.rows.length === 0 ? (
        <p className="text-slate-500">{t('comms.empty')}</p>
      ) : (
        <ol className="space-y-3">
          {comms.data.rows.map((c) => {
            const when = formatDateTime(c.occurredAt);
            const type = commTypeLabel(c.type);
            return (
              <li key={c.id} className="rounded-md border border-slate-100 p-3">
                <article
                  aria-label={tf('comms.recordLabel', {
                    type,
                    date: when,
                    name: c.author.displayName,
                  })}
                >
                  <header className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium">
                      {type}
                    </span>
                    <time dateTime={c.occurredAt} dir="ltr">
                      {when}
                    </time>
                    {c.contact && (
                      <span className="text-slate-600">
                        {tf('comms.with', { name: c.contact.name })}
                      </span>
                    )}
                    <span className="text-slate-500">
                      {tf('comms.by', { name: c.author.displayName })}
                    </span>
                  </header>
                  <p className="mt-2 whitespace-pre-wrap">{c.summary}</p>

                  {c.tasks.length > 0 && (
                    <div className="mt-2">
                      <h3 className="text-xs font-medium text-slate-500">
                        {t('comms.tasksFromThis')}
                      </h3>
                      <ul className="mt-1 space-y-1 text-sm">
                        {c.tasks.map((task) => (
                          <li key={task.id} className="flex flex-wrap items-center gap-2">
                            <TaskStatusBadge status={task.status} />
                            <span className="font-medium">{task.title}</span>
                            <span className="text-slate-600">· {task.assignee.displayName}</span>
                            <span>
                              · <DueDate task={task} />
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {(canWrite || c.canEdit) && (
                    <div className="mt-2 flex flex-wrap gap-3 text-sm">
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => setFollowUp(c)}
                          aria-label={tf('comms.followUpFor', {
                            type,
                            date: when,
                            name: c.author.displayName,
                          })}
                          className="rounded-md bg-blue-50 px-2 py-1 font-medium text-blue-800 ring-1 ring-blue-200 hover:bg-blue-100"
                        >
                          {t('comms.followUp')}
                        </button>
                      )}
                      {c.canEdit && (
                        <button
                          type="button"
                          onClick={() => setEditing({ kind: 'edit', comm: c })}
                          aria-label={tf('comms.editFor', {
                            type,
                            date: when,
                            name: c.author.displayName,
                          })}
                          className="underline"
                        >
                          {t('common.edit')}
                        </button>
                      )}
                    </div>
                  )}
                </article>
              </li>
            );
          })}
        </ol>
      )}

      {pages > 1 && (
        <nav aria-label={t('comms.pagination')} className="mt-3 flex items-center gap-2 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40"
          >
            {t('tasks.prevPage')}
          </button>
          <span>
            {page} / {pages}
          </span>
          <button
            type="button"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40"
          >
            {t('tasks.nextPage')}
          </button>
        </nav>
      )}

      <Drawer
        open={editing !== null}
        title={editing?.kind === 'edit' ? t('comms.editTitle') : t('comms.addTitle')}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <CommunicationForm
            clientId={clientId}
            comm={editing.kind === 'edit' ? editing.comm : undefined}
            onSaved={(created) => {
              setEditing(null);
              if (created) setPage(1);
            }}
          />
        )}
      </Drawer>

      <Drawer
        open={followUp !== null}
        title={t('tasks.followUpTitle')}
        onClose={() => setFollowUp(null)}
      >
        {followUp && (
          <TaskForm
            clientId={clientId}
            actor={actor}
            fromCommunication={followUp}
            onSaved={() => setFollowUp(null)}
          />
        )}
      </Drawer>
    </section>
  );
}

function CommunicationForm({
  clientId,
  comm,
  onSaved,
}: {
  clientId: string;
  comm: CommunicationDto | undefined;
  onSaved: (created: boolean) => void;
}) {
  const contacts = useContacts(clientId);
  const save = useSaveCommunication(clientId);
  const [values, setValues] = useState({
    type: comm?.type ?? 'call',
    occurredAt: comm ? toLocalInput(comm.occurredAt) : nowLocalInput(),
    contactId: comm?.contact?.id ?? '',
    summary: comm?.summary ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (key: keyof typeof values) => (value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors(({ [key]: _, ...rest }) => rest);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const occurredAt = fromLocalInput(values.occurredAt);
    const input = {
      type: values.type,
      occurredAt: occurredAt ?? '',
      summary: values.summary,
      contactId: values.contactId || null,
    };
    const found = fieldErrors(communicationInputSchema, input);
    if (!occurredAt) found.occurredAt = t('form.required');
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    save.mutate(
      { ...(comm ? { id: comm.id } : {}), input },
      {
        onSuccess: () => onSaved(!comm),
        onError: (err) => {
          if (err instanceof ApiRequestError && err.code === 'VALIDATION') {
            setErrors(serverFieldErrors(err.details));
          }
        },
      },
    );
  };

  const hasErrors = Object.keys(errors).length > 0;
  const inputClass = (field: string) =>
    `w-full rounded-md border px-3 py-2 ${errors[field] ? 'border-red-600 bg-red-50' : 'border-slate-300'}`;
  const errorFor = (field: string) =>
    errors[field] ? (
      <p id={`comm-${field}-error`} className="mt-1 text-sm text-red-700">
        {errors[field]}
      </p>
    ) : null;
  const aria = (field: string) => ({
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? `comm-${field}-error` : undefined,
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div>
        <label htmlFor="comm-type" className="mb-1 block text-sm font-medium">
          {t('comms.field.type')}
        </label>
        <select
          id="comm-type"
          value={values.type}
          onChange={(e) => set('type')(e.target.value)}
          className={inputClass('type')}
          {...aria('type')}
        >
          {COMMUNICATION_TYPES.map((ct) => (
            <option key={ct} value={ct}>
              {commTypeLabel(ct)}
            </option>
          ))}
        </select>
        {errorFor('type')}
      </div>

      <div>
        <label htmlFor="comm-occurredAt" className="mb-1 block text-sm font-medium">
          {t('comms.field.occurredAt')}
        </label>
        <input
          id="comm-occurredAt"
          type="datetime-local"
          dir="ltr"
          value={values.occurredAt}
          onChange={(e) => set('occurredAt')(e.target.value)}
          className={inputClass('occurredAt')}
          {...aria('occurredAt')}
        />
        {errorFor('occurredAt')}
      </div>

      <div>
        <label htmlFor="comm-contactId" className="mb-1 block text-sm font-medium">
          {t('comms.field.contact')}
        </label>
        <select
          id="comm-contactId"
          value={values.contactId}
          onChange={(e) => set('contactId')(e.target.value)}
          className={inputClass('contactId')}
          {...aria('contactId')}
        >
          <option value="">{t('comms.noContact')}</option>
          {(contacts.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {errorFor('contactId')}
      </div>

      <div>
        <label htmlFor="comm-summary" className="mb-1 block text-sm font-medium">
          {t('comms.field.summary')}
        </label>
        <textarea
          id="comm-summary"
          rows={5}
          maxLength={5000}
          value={values.summary}
          onChange={(e) => set('summary')(e.target.value)}
          className={inputClass('summary')}
          {...aria('summary')}
        />
        {errorFor('summary')}
      </div>

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
    </form>
  );
}
