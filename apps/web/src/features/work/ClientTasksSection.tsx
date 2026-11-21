import { useState } from 'react';
import type { UserDto } from '@agency-crm/shared';
import { Drawer } from '@/components/Drawer';
import { t } from '@/lib/i18n';
import { TaskForm } from './TaskForm';
import { TasksTable } from './TasksTable';

/** Tasks of one client (everyone's), with "משימה חדשה". */
export function ClientTasksSection({
  clientId,
  canWrite,
  actor,
}: {
  clientId: string;
  canWrite: boolean;
  actor: UserDto;
}) {
  const [showAll, setShowAll] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  return (
    <section
      aria-labelledby="client-tasks-title"
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="client-tasks-title" className="text-lg font-semibold">
          {t('tasks.clientTitle')}
        </h2>
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => {
                setShowAll(e.target.checked);
                setPage(1);
              }}
            />
            {t('tasks.filter.all')}
          </label>
          {canWrite && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50"
            >
              {t('tasks.add')}
            </button>
          )}
        </div>
      </div>
      <TasksTable
        query={{ scope: 'all', clientId, status: showAll ? 'all' : 'active', page, pageSize: 10 }}
        actor={actor}
        showClient={false}
        emptyText={t('tasks.empty')}
        onPage={setPage}
      />
      <Drawer open={creating} title={t('tasks.addTitle')} onClose={() => setCreating(false)}>
        {creating && (
          <TaskForm clientId={clientId} actor={actor} onSaved={() => setCreating(false)} />
        )}
      </Drawer>
    </section>
  );
}
