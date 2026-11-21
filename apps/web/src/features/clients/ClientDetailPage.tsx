import { useState } from 'react';
import type { UserDto } from '@agency-crm/shared';
import { ConfirmInline } from '@/components/ConfirmInline';
import { Drawer } from '@/components/Drawer';
import { ApiRequestError, errorMessage } from '@/lib/api';
import { formatDateTime, t } from '@/lib/i18n';
import { useArchiveClient, useClient } from './api';
import { ClientForm } from './ClientForm';
import { ContactsSection } from './ContactsSection';
import { StaffSection } from './StaffSection';
import { PhotoBlock } from './PhotoBlock';
import { StatusBadge } from './StatusBadge';

const ltr = (v: string | null) => (v ? <span dir="ltr">{v}</span> : t('common.none'));

export function ClientDetailPage({
  id,
  user,
  onBack,
}: {
  id: string;
  user: UserDto;
  onBack: () => void;
}) {
  const client = useClient(id);
  const archive = useArchiveClient();
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const back = (
    <button type="button" onClick={onBack} className="text-sm text-blue-800 underline">
      → {t('clients.backToList')}
    </button>
  );

  if (client.isPending) return <p role="status">{t('common.loading')}</p>;
  if (client.isError) {
    const notFound = client.error instanceof ApiRequestError && client.error.status === 404;
    return (
      <div className="space-y-3">
        {back}
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
          {notFound ? t('clients.notFound') : errorMessage(client.error)}
        </p>
      </div>
    );
  }

  const c = client.data;
  const archived = c.status === 'archived';
  const rows: [string, React.ReactNode][] = [
    [t('clients.field.businessName'), c.businessName ?? t('common.none')],
    [t('clients.field.industry'), c.industry ?? t('common.none')],
    [t('clients.field.phone'), ltr(c.phone)],
    [t('clients.field.email'), ltr(c.email)],
    [t('clients.col.owners'), c.owners.map((o) => o.displayName).join(', ') || t('common.none')],
    [t('clients.createdAt'), <span dir="ltr">{formatDateTime(c.createdAt)}</span>],
    [t('clients.col.updatedAt'), <span dir="ltr">{formatDateTime(c.updatedAt)}</span>],
  ];

  return (
    <article aria-labelledby="client-title" className="space-y-6">
      {back}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <PhotoBlock
            clientId={c.id}
            name={c.name}
            photoUrl={c.photoUrl}
            canEdit={c.permissions.canEdit}
          />
          <div className="space-y-1">
            <h1 id="client-title" className="text-2xl font-bold">
              {c.name}
            </h1>
            <StatusBadge client={c} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {c.permissions.canEdit && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border border-slate-300 px-3 py-2 hover:bg-slate-50"
            >
              {t('common.edit')}
            </button>
          )}
          {c.permissions.canArchive &&
            (archived ? (
              <button
                type="button"
                disabled={archive.isPending}
                onClick={() => archive.mutate({ id: c.id, archived: false })}
                className="rounded-md border border-slate-300 px-3 py-2 hover:bg-slate-50"
              >
                {t('clients.unarchive')}
              </button>
            ) : (
              <button
                type="button"
                id="client-archive-button"
                onClick={() => setConfirmArchive(true)}
                className="rounded-md border border-red-300 px-3 py-2 text-red-800 hover:bg-red-50"
              >
                {t('clients.archive')}
              </button>
            ))}
        </div>
      </header>

      {/* In-page confirmation (no browser confirm() dialogs). */}
      {confirmArchive && !archived && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <ConfirmInline
            question={t('clients.archiveConfirm')}
            target={c.name}
            returnFocusTo="client-archive-button"
            busy={archive.isPending}
            onConfirm={() =>
              archive.mutate(
                { id: c.id, archived: true },
                { onSuccess: () => setConfirmArchive(false) },
              )
            }
            onCancel={() => setConfirmArchive(false)}
          />
        </div>
      )}
      {archive.isError && (
        <p role="alert" className="text-sm text-red-700">
          {errorMessage(archive.error)}
        </p>
      )}
      {archived && (
        <p
          role="note"
          className="rounded-lg border border-slate-200 bg-slate-100 p-3 text-slate-700"
        >
          {t('clients.archivedNotice')}
        </p>
      )}

      <section
        aria-labelledby="client-details"
        className="rounded-lg border border-slate-200 bg-white p-4"
      >
        <h2 id="client-details" className="mb-3 text-lg font-semibold">
          {t('clients.detailsTitle')}
        </h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex gap-2">
              <dt className="min-w-24 text-slate-500">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {c.notes && (
          <div className="mt-3">
            <h3 className="text-sm text-slate-500">{t('clients.field.notes')}</h3>
            <p className="whitespace-pre-wrap">{c.notes}</p>
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <ContactsSection clientId={c.id} canManage={c.permissions.canManageContacts} />
        <StaffSection clientId={c.id} canManage={c.permissions.canManageStaff} actor={user} />
      </div>

      <Drawer open={editing} title={t('clients.editTitle')} onClose={() => setEditing(false)}>
        <ClientForm client={c} onSaved={() => setEditing(false)} />
      </Drawer>
    </article>
  );
}
