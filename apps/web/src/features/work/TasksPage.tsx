import { useState } from 'react';
import { TASK_STATUS_FILTERS, type UserDto } from '@agency-crm/shared';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { t, type MessageKey } from '@/lib/i18n';
import { TasksTable } from './TasksTable';

type Scope = 'mine' | 'all';
type StatusFilter = (typeof TASK_STATUS_FILTERS)[number];

const statusFilterLabel = (s: StatusFilter): string =>
  s === 'active' || s === 'all'
    ? t(`tasks.filter.${s}` as MessageKey)
    : t(`tasks.status.${s}` as MessageKey);

/** "משימות": my work queue by default (assigned to me, open / in progress, by deadline). */
export function TasksPage({
  user,
  onOpenClient,
}: {
  user: UserDto;
  onOpenClient: (id: string) => void;
}) {
  const [scope, setScope] = useState<Scope>('mine');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [overdue, setOverdue] = useState(false);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const debouncedQ = useDebouncedValue(q.trim(), 300);
  // Any filter change starts again at page 1.
  const reset =
    <T,>(fn: (v: T) => void) =>
    (v: T) => {
      fn(v);
      setPage(1);
    };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('tasks.pageTitle')}</h1>

      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 bg-white p-3">
        <fieldset>
          <legend className="mb-1 text-sm font-medium">{t('tasks.scope')}</legend>
          <div className="flex gap-3 text-sm">
            {(['mine', 'all'] as const).map((s) => (
              <label key={s} className="flex items-center gap-1">
                <input
                  type="radio"
                  name="tasks-scope"
                  value={s}
                  checked={scope === s}
                  onChange={() => reset(setScope)(s)}
                />
                {t(`tasks.scope.${s}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="tasks-status" className="mb-1 block text-sm font-medium">
            {t('tasks.filter.status')}
          </label>
          <select
            id="tasks-status"
            value={status}
            onChange={(e) => reset(setStatus)(e.target.value as StatusFilter)}
            className="rounded-md border border-slate-300 px-2 py-1"
          >
            {TASK_STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {statusFilterLabel(s)}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={overdue}
            onChange={(e) => reset(setOverdue)(e.target.checked)}
          />
          {t('tasks.filter.overdue')}
        </label>
        <div>
          <label htmlFor="tasks-search" className="mb-1 block text-sm font-medium">
            {t('tasks.search')}
          </label>
          <input
            id="tasks-search"
            type="search"
            value={q}
            maxLength={100}
            onChange={(e) => reset(setQ)(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1"
          />
        </div>
      </div>

      <TasksTable
        query={{
          scope,
          status,
          overdue: overdue ? 'true' : undefined,
          q: debouncedQ || undefined,
          page,
          pageSize: 20,
        }}
        actor={user}
        showClient
        onOpenClient={onOpenClient}
        emptyText={
          scope === 'mine' && status === 'active' ? t('tasks.emptyMine') : t('tasks.empty')
        }
        onPage={setPage}
      />
    </div>
  );
}
