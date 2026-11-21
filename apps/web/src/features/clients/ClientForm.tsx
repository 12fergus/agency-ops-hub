import { useState, type FormEvent } from 'react';
import { clientInputSchema, type ClientDto } from '@agency-crm/shared';
import { Field } from '@/components/Field';
import { ApiRequestError, errorMessage } from '@/lib/api';
import { fieldErrors, serverFieldErrors } from '@/lib/formErrors';
import { t } from '@/lib/i18n';
import { useClientStatuses } from '../client-statuses/api';
import { useSaveClient } from './api';
import { ColorBadge } from './StatusBadge';

type Values = {
  name: string;
  businessName: string;
  industry: string;
  phone: string;
  email: string;
  notes: string;
  /** '' = server default (new clients). */
  statusId: string;
};

const fromClient = (c?: ClientDto): Values => ({
  name: c?.name ?? '',
  businessName: c?.businessName ?? '',
  industry: c?.industry ?? '',
  phone: c?.phone ?? '',
  email: c?.email ?? '',
  notes: c?.notes ?? '',
  statusId: c?.clientStatus?.id ?? '',
});

/** Create (no `client`) or edit form, rendered inside the Drawer. */
export function ClientForm({
  client,
  onSaved,
}: {
  client?: ClientDto;
  onSaved: (c: ClientDto) => void;
}) {
  const [values, setValues] = useState<Values>(() => fromClient(client));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useSaveClient();
  const statuses = useClientStatuses();
  const selected =
    statuses.data?.find((s) => s.id === values.statusId) ??
    (values.statusId === '' ? statuses.data?.find((s) => s.isDefault) : undefined);

  const set = (key: keyof Values) => (value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors(({ [key]: _, ...rest }) => rest);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    // '' means "server default": don't send it.
    const { statusId, ...rest } = values;
    const payload = statusId ? { ...rest, statusId } : rest;
    const found = fieldErrors(clientInputSchema, payload);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    save.mutate(
      { ...(client ? { id: client.id } : {}), values: payload },
      {
        onSuccess: onSaved,
        onError: (err) => {
          if (err instanceof ApiRequestError && err.code === 'VALIDATION') {
            setErrors(serverFieldErrors(err.details));
          }
        },
      },
    );
  };

  const hasErrors = Object.keys(errors).length > 0;
  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className="space-y-4"
      aria-label={t(client ? 'clients.editTitle' : 'clients.new')}
    >
      <Field
        id="client-name"
        label={`${t('clients.field.name')} *`}
        value={values.name}
        maxLength={120}
        error={errors.name ?? null}
        onChange={(e) => set('name')(e.target.value)}
      />
      <Field
        id="client-business"
        label={t('clients.field.businessName')}
        value={values.businessName}
        maxLength={160}
        error={errors.businessName ?? null}
        onChange={(e) => set('businessName')(e.target.value)}
      />
      <Field
        id="client-industry"
        label={t('clients.field.industry')}
        value={values.industry}
        maxLength={80}
        error={errors.industry ?? null}
        onChange={(e) => set('industry')(e.target.value)}
      />
      <Field
        id="client-phone"
        label={t('clients.field.phone')}
        type="tel"
        dir="ltr"
        className="text-start"
        autoComplete="off"
        value={values.phone}
        maxLength={40}
        error={errors.phone ?? null}
        onChange={(e) => set('phone')(e.target.value)}
      />
      <Field
        id="client-email"
        label={t('clients.field.email')}
        type="email"
        dir="ltr"
        className="text-start"
        autoComplete="off"
        value={values.email}
        error={errors.email ?? null}
        onChange={(e) => set('email')(e.target.value)}
      />

      <div>
        <label htmlFor="client-status" className="mb-1 block text-sm font-medium">
          {t('clients.field.status')}
        </label>
        <div className="flex items-center gap-2">
          <select
            id="client-status"
            value={values.statusId || selected?.id || ''}
            onChange={(e) => set('statusId')(e.target.value)}
            className="flex-1 rounded-md border border-slate-300 px-3 py-2"
          >
            {(statuses.data ?? []).map((st) => (
              <option key={st.id} value={st.id}>
                {st.name}
              </option>
            ))}
          </select>
          {/* Color preview next to the select (option elements can't be reliably colored). */}
          {selected && <ColorBadge name={selected.name} color={selected.color} />}
        </div>
      </div>

      <div>
        <label htmlFor="client-notes" className="mb-1 block text-sm font-medium">
          {t('clients.field.notes')}
        </label>
        <textarea
          id="client-notes"
          rows={4}
          maxLength={5000}
          value={values.notes}
          aria-invalid={errors.notes ? true : undefined}
          aria-describedby={errors.notes ? 'client-notes-error' : undefined}
          onChange={(e) => set('notes')(e.target.value)}
          className={`w-full rounded-md border px-3 py-2 ${errors.notes ? 'border-red-600 bg-red-50' : 'border-slate-300'}`}
        />
        {errors.notes && (
          <p id="client-notes-error" className="mt-1 text-sm text-red-700">
            {errors.notes}
          </p>
        )}
      </div>

      {(hasErrors || save.isError) && (
        <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-700">
          {hasErrors ? t('form.fixErrors') : errorMessage(save.error)}
        </p>
      )}

      <button
        type="submit"
        disabled={save.isPending}
        className="w-full rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:opacity-60"
      >
        {t(client ? 'clients.save' : 'clients.create')}
      </button>
    </form>
  );
}
