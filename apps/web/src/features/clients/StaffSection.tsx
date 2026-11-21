import { useState, type FormEvent } from 'react';
import type { UserDto } from '@agency-crm/shared';
import { ConfirmInline } from '@/components/ConfirmInline';
import { errorMessage } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { useAssignableUsers, useStaff, useStaffMutations } from './api';

/**
 * Assigned staff. What the controls offer mirrors the server rules (ADR-012): admins can add
 * owners or collaborators and remove anyone; owner-managers can add collaborators and remove
 * collaborators only. The server re-checks every action regardless of what the UI shows.
 */
export function StaffSection({
  clientId,
  canManage,
  actor,
}: {
  clientId: string;
  canManage: boolean;
  actor: UserDto;
}) {
  const staff = useStaff(clientId);
  const assignable = useAssignableUsers(canManage);
  const { add, remove } = useStaffMutations(clientId);
  const [userId, setUserId] = useState('');
  const [membershipRole, setMembershipRole] = useState<'owner' | 'collaborator'>('collaborator');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const isAdmin = actor.role === 'admin';

  const assignedIds = new Set((staff.data ?? []).map((s) => s.userId));
  const candidates = (assignable.data ?? []).filter((u) => !assignedIds.has(u.id));

  const onAdd = (e: FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    add.mutate(
      { userId, membershipRole: isAdmin ? membershipRole : 'collaborator' },
      { onSuccess: () => setUserId('') },
    );
  };

  return (
    <section
      aria-labelledby="staff-title"
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 id="staff-title" className="mb-3 text-lg font-semibold">
        {t('staff.title')}
      </h2>

      {staff.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : staff.isError ? (
        <p role="alert" className="text-red-700">
          {errorMessage(staff.error)}
        </p>
      ) : staff.data.length === 0 ? (
        <p className="text-slate-500">{t('staff.empty')}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {staff.data.map((m) => {
            const removable = canManage && (isAdmin || m.membershipRole !== 'owner');
            return (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className="font-medium">
                    {m.displayName}
                    <span className="ms-2 text-xs text-slate-500">
                      {t(m.membershipRole === 'owner' ? 'staff.owner' : 'staff.collaborator')} ·{' '}
                      {t(`role.${m.role}` as MessageKey)}
                    </span>
                  </p>
                  <p className="text-sm text-slate-600">
                    <span dir="ltr">{m.email}</span>
                  </p>
                </div>
                {removable &&
                  (confirmRemove === m.userId ? (
                    <ConfirmInline
                      question={t('staff.removeConfirm')}
                      target={m.displayName}
                      returnFocusTo={`staff-remove-${m.userId}`}
                      busy={remove.isPending}
                      onConfirm={() =>
                        remove.mutate(m.userId, { onSettled: () => setConfirmRemove(null) })
                      }
                      onCancel={() => setConfirmRemove(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      id={`staff-remove-${m.userId}`}
                      onClick={() => setConfirmRemove(m.userId)}
                      className="text-sm text-red-700 underline"
                      aria-label={`${t('staff.remove')}: ${m.displayName}`}
                    >
                      {t('staff.remove')}
                    </button>
                  ))}
              </li>
            );
          })}
        </ul>
      )}

      {canManage && (
        <form
          onSubmit={onAdd}
          className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4"
          aria-label={t('staff.addLabel')}
        >
          <div className="min-w-48 flex-1">
            <label htmlFor="staff-user" className="mb-1 block text-sm font-medium">
              {t('staff.user')}
            </label>
            <select
              id="staff-user"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              disabled={candidates.length === 0}
            >
              <option value="">
                {candidates.length ? t('staff.choose') : t('staff.noCandidates')}
              </option>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName} ({t(`role.${u.role}` as MessageKey)})
                </option>
              ))}
            </select>
          </div>
          {isAdmin && (
            <div>
              <label htmlFor="staff-role" className="mb-1 block text-sm font-medium">
                {t('staff.asRole')}
              </label>
              <select
                id="staff-role"
                value={membershipRole}
                onChange={(e) => setMembershipRole(e.target.value as 'owner' | 'collaborator')}
                className="rounded-md border border-slate-300 px-3 py-2"
              >
                <option value="collaborator">{t('staff.collaborator')}</option>
                <option value="owner">{t('staff.owner')}</option>
              </select>
            </div>
          )}
          <button
            type="submit"
            disabled={!userId || add.isPending}
            className="rounded-md bg-blue-700 px-4 py-2 text-white hover:bg-blue-800 disabled:opacity-50"
          >
            {t('staff.add')}
          </button>
        </form>
      )}
      {(add.isError || remove.isError) && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {errorMessage(add.error ?? remove.error)}
        </p>
      )}
    </section>
  );
}
