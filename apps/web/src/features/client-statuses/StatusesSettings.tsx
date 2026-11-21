import { useState, type FormEvent } from 'react';
import { STATUS_COLORS, type ClientStatusDto, type StatusColor } from '@agency-crm/shared';
import { ConfirmInline } from '@/components/ConfirmInline';
import { errorMessage } from '@/lib/api';
import { t, tf, type MessageKey } from '@/lib/i18n';
import { ColorBadge } from '../clients/StatusBadge';
import { useClientStatuses, useStatusMutations } from './api';

const colorLabel = (c: StatusColor) => t(`color.${c}` as MessageKey);

/** Admin page: define the client statuses (name, color, order, default). */
export function StatusesSettings() {
  const statuses = useClientStatuses();
  const m = useStatusMutations();
  const [name, setName] = useState('');
  const [color, setColor] = useState<StatusColor>('blue');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const list = statuses.data ?? [];
  const move = (index: number, delta: -1 | 1) => {
    const ids = list.map((s) => s.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    m.reorder.mutate(ids);
  };

  const onAdd = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    m.create.mutate({ name: name.trim(), color }, { onSuccess: () => setName('') });
  };

  const mutationError = [m.create, m.update, m.reorder, m.remove].find((x) => x.isError)?.error;

  return (
    <section aria-labelledby="settings-title" className="max-w-3xl space-y-6">
      <h1 id="settings-title" className="text-xl font-bold">
        {t('settings.title')}
      </h1>
      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">{t('statuses.title')}</h2>
        <p className="text-sm text-slate-600">{t('statuses.intro')}</p>

        {statuses.isPending ? (
          <p role="status">{t('common.loading')}</p>
        ) : statuses.isError ? (
          <p role="alert" className="text-red-700">
            {errorMessage(statuses.error)}
          </p>
        ) : (
          <ol className="divide-y divide-slate-100">
            {list.map((s, i) => (
              <StatusRow
                key={s.id}
                status={s}
                first={i === 0}
                last={i === list.length - 1}
                onMove={(d) => move(i, d)}
                onSave={(patch) => m.update.mutate({ id: s.id, ...patch })}
                onMakeDefault={() => m.update.mutate({ id: s.id, isDefault: true })}
                confirming={confirmDelete === s.id}
                onAskDelete={() => setConfirmDelete(s.id)}
                onCancelDelete={() => setConfirmDelete(null)}
                onDelete={() => m.remove.mutate(s.id, { onSettled: () => setConfirmDelete(null) })}
                busy={m.update.isPending || m.reorder.isPending || m.remove.isPending}
              />
            ))}
          </ol>
        )}

        {mutationError && (
          <p role="alert" className="text-sm text-red-700">
            {errorMessage(mutationError)}
          </p>
        )}

        <form
          onSubmit={onAdd}
          aria-label={t('statuses.add')}
          className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3"
        >
          <div>
            <label htmlFor="new-status-name" className="mb-1 block text-sm font-medium">
              {t('statuses.name')}
            </label>
            <input
              id="new-status-name"
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="new-status-color" className="mb-1 block text-sm font-medium">
              {t('statuses.color')}
            </label>
            <select
              id="new-status-color"
              value={color}
              onChange={(e) => setColor(e.target.value as StatusColor)}
              className="rounded-md border border-slate-300 px-3 py-2"
            >
              {STATUS_COLORS.map((c) => (
                <option key={c} value={c}>
                  {colorLabel(c)}
                </option>
              ))}
            </select>
          </div>
          <span className="flex items-center gap-1 text-sm text-slate-600">
            {t('statuses.preview')}:
            <ColorBadge name={name.trim() || t('statuses.name')} color={color} />
          </span>
          <button
            type="submit"
            disabled={!name.trim() || m.create.isPending}
            className="rounded-md bg-blue-700 px-4 py-2 text-white hover:bg-blue-800 disabled:opacity-50"
          >
            {t('statuses.add')}
          </button>
        </form>
      </div>
    </section>
  );
}

function StatusRow(props: {
  status: ClientStatusDto;
  first: boolean;
  last: boolean;
  busy: boolean;
  confirming: boolean;
  onMove: (delta: -1 | 1) => void;
  onSave: (patch: { name?: string; color?: StatusColor }) => void;
  onMakeDefault: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  const s = props.status;
  const [name, setName] = useState(s.name);
  const [color, setColor] = useState<StatusColor>(s.color);
  const dirty = name.trim() !== s.name || color !== s.color;
  const deletable = !s.isDefault && s.clientCount === 0; // admin page: counts are present
  const btn =
    'rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50 disabled:opacity-40';

  return (
    <li className="flex flex-wrap items-center gap-2 py-3">
      <span className="flex flex-col">
        <button
          type="button"
          className="px-1 leading-none"
          disabled={props.first || props.busy}
          onClick={() => props.onMove(-1)}
          aria-label={`${t('statuses.moveUp')}: ${s.name}`}
        >
          ▲
        </button>
        <button
          type="button"
          className="px-1 leading-none"
          disabled={props.last || props.busy}
          onClick={() => props.onMove(1)}
          aria-label={`${t('statuses.moveDown')}: ${s.name}`}
        >
          ▼
        </button>
      </span>
      <ColorBadge name={name.trim() || s.name} color={color} />
      <label className="sr-only" htmlFor={`status-name-${s.id}`}>
        {`${t('statuses.name')}: ${s.name}`}
      </label>
      <input
        id={`status-name-${s.id}`}
        maxLength={40}
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-40 rounded-md border border-slate-300 px-2 py-1"
      />
      <label className="sr-only" htmlFor={`status-color-${s.id}`}>
        {`${t('statuses.color')}: ${s.name}`}
      </label>
      <select
        id={`status-color-${s.id}`}
        value={color}
        onChange={(e) => setColor(e.target.value as StatusColor)}
        className="rounded-md border border-slate-300 px-2 py-1"
      >
        {STATUS_COLORS.map((c) => (
          <option key={c} value={c}>
            {colorLabel(c)}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={btn}
        disabled={!dirty || !name.trim() || props.busy}
        onClick={() => props.onSave({ name: name.trim(), color })}
      >
        {t('statuses.save')}
      </button>
      {s.isDefault ? (
        <span className="text-sm font-medium text-blue-800">{t('statuses.default')}</span>
      ) : (
        <button type="button" className={btn} disabled={props.busy} onClick={props.onMakeDefault}>
          {t('statuses.makeDefault')}
        </button>
      )}
      <span className="text-xs text-slate-500">
        {tf('statuses.inUse', { count: s.clientCount ?? 0 })}
      </span>
      {props.confirming ? (
        <ConfirmInline
          question={t('statuses.deleteConfirm')}
          target={s.name}
          returnFocusTo={`status-delete-${s.id}`}
          busy={props.busy}
          onConfirm={props.onDelete}
          onCancel={props.onCancelDelete}
        />
      ) : (
        <button
          type="button"
          id={`status-delete-${s.id}`}
          className="text-sm text-red-700 underline disabled:text-slate-400 disabled:no-underline"
          disabled={!deletable}
          title={deletable ? undefined : t('statuses.cantDelete')}
          onClick={props.onAskDelete}
          aria-label={`${t('common.delete')}: ${s.name}`}
        >
          {t('common.delete')}
        </button>
      )}
    </li>
  );
}
