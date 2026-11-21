import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { USER_ROLES, passwordProblems, type UserDto, type UserRole } from '@agency-crm/shared';
import { apiRequest, errorMessage } from '@/lib/api';
import { t, type MessageKey } from '@/lib/i18n';
import { PasswordRules } from '@/components/PasswordRules';

const isPasswordAcceptable = (password: string, email: string) =>
  passwordProblems(password, email).length === 0;

const USERS_KEY = ['users'] as const;

const STATUS_STYLE: Record<UserDto['status'], string> = {
  active: 'text-emerald-700',
  pending: 'font-medium text-amber-700',
  disabled: 'text-slate-500',
};
const roleLabel = (r: UserRole) => t(`role.${r}` as MessageKey);

/** Admin-only page. The server enforces admin-only access; hiding it in the UI is cosmetic. */
export function UsersPage({ currentUserId }: { currentUserId: string }) {
  const qc = useQueryClient();
  const users = useQuery({
    queryKey: USERS_KEY,
    queryFn: async () => (await apiRequest<UserDto[]>('GET', '/users')).data,
  });

  const update = useMutation({
    mutationFn: (a: { id: string; role?: UserRole; active?: boolean }) =>
      a.role
        ? apiRequest('PATCH', `/users/${a.id}/role`, { role: a.role })
        : apiRequest('POST', `/users/${a.id}/${a.active ? 'enable' : 'disable'}`),
    onSettled: () => qc.invalidateQueries({ queryKey: USERS_KEY }),
  });

  return (
    <section aria-labelledby="users-title" className="space-y-6">
      <h1 id="users-title" className="text-xl font-bold">
        {t('users.title')}
      </h1>
      <p className="text-sm text-slate-600">{t('users.roleChangeNote')}</p>

      {update.isError && (
        <p role="alert" className="text-sm text-red-700">
          {errorMessage(update.error)}
        </p>
      )}

      {users.isPending ? (
        <p>{t('common.loading')}</p>
      ) : users.isError ? (
        <p role="alert" className="text-red-700">
          {errorMessage(users.error)}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-start text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-start">{t('users.colName')}</th>
                <th className="px-3 py-2 text-start">{t('users.colEmail')}</th>
                <th className="px-3 py-2 text-start">{t('users.colRole')}</th>
                <th className="px-3 py-2 text-start">{t('users.colStatus')}</th>
                <th className="px-3 py-2 text-start">{t('users.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {users.data.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                    {t('users.empty')}
                  </td>
                </tr>
              )}
              {users.data.map((u) => {
                const self = u.id === currentUserId;
                return (
                  <tr key={u.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      {u.displayName}{' '}
                      {self && <span className="text-slate-500">{t('users.you')}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span dir="ltr">{u.email}</span>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        aria-label={`${t('users.colRole')}: ${u.displayName}`}
                        value={u.role}
                        disabled={self || update.isPending}
                        onChange={(e) =>
                          update.mutate({ id: u.id, role: e.target.value as UserRole })
                        }
                        className="rounded border border-slate-300 px-2 py-1"
                      >
                        {USER_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {roleLabel(r)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <span className={STATUS_STYLE[u.status]}>
                        {t(`users.status.${u.status}` as MessageKey)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {!self && (
                        <button
                          type="button"
                          disabled={update.isPending}
                          onClick={() => update.mutate({ id: u.id, active: !u.isActive })}
                          className={
                            u.status === 'pending'
                              ? 'rounded bg-emerald-700 px-2 py-1 text-white hover:bg-emerald-800'
                              : 'rounded border border-slate-300 px-2 py-1 hover:bg-slate-50'
                          }
                        >
                          {u.status === 'pending'
                            ? t('users.approve')
                            : u.isActive
                              ? t('users.disable')
                              : t('users.enable')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <CreateUserForm onCreated={() => qc.invalidateQueries({ queryKey: USERS_KEY })} />
    </section>
  );
}

function CreateUserForm({ onCreated }: { onCreated: () => void }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<UserRole>('employee');
  const [password, setPassword] = useState('');
  const [showRulesError, setShowRulesError] = useState(false);

  const create = useMutation({
    mutationFn: () => apiRequest<UserDto>('POST', '/users', { email, displayName, role, password }),
    onSuccess: () => {
      setEmail('');
      setDisplayName('');
      setRole('employee');
      onCreated();
    },
    onSettled: () => setPassword(''),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    // Same policy as the server; checked here only to give instant feedback.
    if (!isPasswordAcceptable(password, email)) {
      setShowRulesError(true);
      return;
    }
    setShowRulesError(false);
    create.mutate();
  };

  const field = 'w-full rounded-md border border-slate-300 px-3 py-2';
  return (
    <form
      onSubmit={onSubmit}
      aria-labelledby="create-user-title"
      className="max-w-lg space-y-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 id="create-user-title" className="text-lg font-semibold">
        {t('users.createTitle')}
      </h2>
      <label className="block">
        <span className="mb-1 block text-sm">{t('users.displayName')}</span>
        <input
          required
          maxLength={100}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className={field}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm">{t('auth.email')}</span>
        <input
          type="email"
          dir="ltr"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`${field} text-start`}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm">{t('users.role')}</span>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as UserRole)}
          className={field}
        >
          {USER_ROLES.map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm">{t('users.initialPassword')}</span>
        <input
          type="password"
          dir="ltr"
          autoComplete="new-password"
          required
          aria-describedby="new-password-rules"
          aria-invalid={showRulesError || undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={`${field} text-start`}
        />
      </label>
      <PasswordRules id="new-password-rules" password={password} email={email} />
      {showRulesError && !isPasswordAcceptable(password, email) && (
        <p role="alert" className="text-sm text-red-700">
          {t('password.fixFirst')}
        </p>
      )}
      {create.isError && (
        <p role="alert" className="text-sm text-red-700">
          {errorMessage(create.error)}
        </p>
      )}
      {create.isSuccess && (
        <p role="status" className="text-sm text-emerald-700">
          {t('users.created')}
        </p>
      )}
      <button
        type="submit"
        disabled={create.isPending}
        className="rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:opacity-60"
      >
        {t('users.create')}
      </button>
    </form>
  );
}
