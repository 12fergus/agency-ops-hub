import { useState, type FormEvent } from 'react';
import { contactInputSchema, type ContactDto } from '@agency-crm/shared';
import { ConfirmInline } from '@/components/ConfirmInline';
import { Drawer } from '@/components/Drawer';
import { Field } from '@/components/Field';
import { ApiRequestError, errorMessage } from '@/lib/api';
import { fieldErrors, serverFieldErrors } from '@/lib/formErrors';
import { t } from '@/lib/i18n';
import { useContacts, useDeleteContact, useSaveContact } from './api';

export function ContactsSection({ clientId, canManage }: { clientId: string; canManage: boolean }) {
  const contacts = useContacts(clientId);
  const del = useDeleteContact(clientId);
  const [editing, setEditing] = useState<ContactDto | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  return (
    <section
      aria-labelledby="contacts-title"
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 id="contacts-title" className="text-lg font-semibold">
          {t('contacts.title')}
        </h2>
        {canManage && (
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
          >
            {t('contacts.add')}
          </button>
        )}
      </div>

      {contacts.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : contacts.isError ? (
        <p role="alert" className="text-red-700">
          {errorMessage(contacts.error)}
        </p>
      ) : contacts.data.length === 0 ? (
        <p className="text-slate-500">{t('contacts.empty')}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {contacts.data.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
              <div>
                <p className="font-medium">
                  {c.name}
                  {c.isPrimary && (
                    <span className="ms-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-800 ring-1 ring-blue-200">
                      {t('contacts.primary')}
                    </span>
                  )}
                </p>
                {c.title && <p className="text-sm text-slate-600">{c.title}</p>}
                <p className="text-sm">
                  {c.phone && <span dir="ltr">{c.phone}</span>}
                  {c.phone && c.email && ' · '}
                  {c.email && <span dir="ltr">{c.email}</span>}
                </p>
              </div>
              {canManage &&
                (confirmDelete === c.id ? (
                  <ConfirmInline
                    question={t('contacts.deleteConfirm')}
                    target={c.name}
                    returnFocusTo={`contact-delete-${c.id}`}
                    busy={del.isPending}
                    onConfirm={() => del.mutate(c.id, { onSettled: () => setConfirmDelete(null) })}
                    onCancel={() => setConfirmDelete(null)}
                  />
                ) : (
                  <div className="flex gap-2 text-sm">
                    <button
                      type="button"
                      onClick={() => setEditing(c)}
                      className="underline"
                      aria-label={`${t('common.edit')}: ${c.name}`}
                    >
                      {t('common.edit')}
                    </button>
                    <button
                      type="button"
                      id={`contact-delete-${c.id}`}
                      onClick={() => setConfirmDelete(c.id)}
                      className="text-red-700 underline"
                      aria-label={`${t('common.delete')}: ${c.name}`}
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                ))}
            </li>
          ))}
        </ul>
      )}
      {del.isError && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {errorMessage(del.error)}
        </p>
      )}

      <Drawer
        open={editing !== null}
        title={editing === 'new' ? t('contacts.add') : t('contacts.editTitle')}
        onClose={() => setEditing(null)}
      >
        {editing !== null && (
          <ContactForm
            clientId={clientId}
            contact={editing === 'new' ? undefined : editing}
            onSaved={() => setEditing(null)}
          />
        )}
      </Drawer>
    </section>
  );
}

function ContactForm({
  clientId,
  contact,
  onSaved,
}: {
  clientId: string;
  contact: ContactDto | undefined;
  onSaved: () => void;
}) {
  const [values, setValues] = useState({
    name: contact?.name ?? '',
    title: contact?.title ?? '',
    phone: contact?.phone ?? '',
    email: contact?.email ?? '',
    isPrimary: contact?.isPrimary ?? false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useSaveContact(clientId);

  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors(({ [key]: _, ...rest }) => rest);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const found = fieldErrors(contactInputSchema, values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    save.mutate(
      { ...(contact ? { id: contact.id } : {}), values },
      {
        onSuccess: onSaved,
        onError: (err) => {
          if (err instanceof ApiRequestError && err.code === 'VALIDATION')
            setErrors(serverFieldErrors(err.details));
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
      aria-label={t(contact ? 'contacts.editTitle' : 'contacts.add')}
    >
      <Field
        id="contact-name"
        label={`${t('contacts.field.name')} *`}
        maxLength={120}
        value={values.name}
        error={errors.name ?? null}
        onChange={(e) => set('name', e.target.value)}
      />
      <Field
        id="contact-title"
        label={t('contacts.field.title')}
        maxLength={80}
        value={values.title}
        error={errors.title ?? null}
        onChange={(e) => set('title', e.target.value)}
      />
      <Field
        id="contact-phone"
        label={t('contacts.field.phone')}
        type="tel"
        dir="ltr"
        className="text-start"
        maxLength={40}
        value={values.phone}
        error={errors.phone ?? null}
        onChange={(e) => set('phone', e.target.value)}
      />
      <Field
        id="contact-email"
        label={t('contacts.field.email')}
        type="email"
        dir="ltr"
        className="text-start"
        value={values.email}
        error={errors.email ?? null}
        onChange={(e) => set('email', e.target.value)}
      />
      <label htmlFor="contact-primary" className="flex items-center gap-2">
        <input
          id="contact-primary"
          type="checkbox"
          checked={values.isPrimary}
          onChange={(e) => set('isPrimary', e.target.checked)}
        />
        {t('contacts.field.isPrimary')}
      </label>
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
        {t('contacts.save')}
      </button>
    </form>
  );
}
