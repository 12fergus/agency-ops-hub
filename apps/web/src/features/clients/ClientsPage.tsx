import { useMemo, useState } from 'react';
import {
  createColumnHelper,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type PaginationState,
  type SortingState,
} from '@tanstack/react-table';
import type { ClientDto, ClientListQuery, ClientSortField, UserDto } from '@agency-crm/shared';
import { Drawer } from '@/components/Drawer';
import { errorMessage } from '@/lib/api';
import { formatDateTime, t, tf, type MessageKey } from '@/lib/i18n';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { useAssignableUsers, useClientList } from './api';
import { ClientForm } from './ClientForm';
import { useClientStatuses } from '../client-statuses/api';
import { ClientAvatar } from './ClientAvatar';
import { StatusBadge } from './StatusBadge';

// Stable at module scope (TanStack Table v9 rule: features/columns/fallback data must be stable).
const features = tableFeatures({ rowSortingFeature, rowPaginationFeature });
const helper = createColumnHelper<typeof features, ClientDto>();
const NO_ROWS: ClientDto[] = [];
const SORTABLE: ReadonlySet<string> = new Set<ClientSortField>([
  'name',
  'businessName',
  'status',
  'updatedAt',
]);
/** Lifecycle filter (archived or not); the business status is filtered separately. */
const STATUS_FILTERS = ['current', 'archived', 'all'] as const;

const ltr = (value: string | null) =>
  value ? (
    <span dir="ltr">{value}</span>
  ) : (
    <span className="text-slate-400">{t('common.none')}</span>
  );

export function ClientsPage({ user, onOpen }: { user: UserDto; onOpen: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>('current');
  const [statusId, setStatusId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
  const [creating, setCreating] = useState(false);
  const q = useDebouncedValue(search.trim(), 300);

  // Changing a filter returns to the first page.
  const resetPage = () => setPagination((p) => ({ ...p, pageIndex: 0 }));

  const query: ClientListQuery = {
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    status,
    sort: (sorting[0]?.id as ClientSortField | undefined) ?? 'name',
    dir: sorting[0]?.desc ? 'desc' : 'asc',
    ...(q ? { q } : {}),
    ...(ownerId ? { ownerId } : {}),
    ...(statusId ? { statusId } : {}),
  };
  const list = useClientList(query);
  const canFilterByOwner = user.role !== 'employee';
  const assignable = useAssignableUsers(canFilterByOwner);
  const statuses = useClientStatuses();

  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor('name', {
          header: () => t('clients.col.name'),
          cell: (info) => (
            <span className="flex items-center gap-2">
              <ClientAvatar name={info.getValue()} photoUrl={info.row.original.photoUrl} />
              <button
                type="button"
                onClick={() => onOpen(info.row.original.id)}
                className="text-start font-medium text-blue-800 underline-offset-2 hover:underline"
              >
                {info.getValue()}
              </button>
            </span>
          ),
        }),
        helper.accessor('businessName', {
          header: () => t('clients.col.businessName'),
          cell: (info) =>
            info.getValue() ?? <span className="text-slate-400">{t('common.none')}</span>,
        }),
        helper.accessor('status', {
          header: () => t('clients.col.status'),
          // Sorted server-side by the admin-defined status order.
          cell: (info) => <StatusBadge client={info.row.original} />,
        }),
        helper.accessor('industry', {
          header: () => t('clients.col.industry'),
          enableSorting: false,
          cell: (info) =>
            info.getValue() ?? <span className="text-slate-400">{t('common.none')}</span>,
        }),
        helper.accessor('phone', {
          header: () => t('clients.col.phone'),
          enableSorting: false,
          cell: (info) => ltr(info.getValue()),
        }),
        helper.accessor('email', {
          header: () => t('clients.col.email'),
          enableSorting: false,
          cell: (info) => ltr(info.getValue()),
        }),
        helper.accessor('owners', {
          header: () => t('clients.col.owners'),
          enableSorting: false,
          cell: (info) =>
            info.getValue().length ? (
              info
                .getValue()
                .map((o) => o.displayName)
                .join(', ')
            ) : (
              <span className="text-slate-400">{t('common.none')}</span>
            ),
        }),
        helper.accessor('updatedAt', {
          header: () => t('clients.col.updatedAt'),
          cell: (info) => <span dir="ltr">{formatDateTime(info.getValue())}</span>,
        }),
      ]),
    [onOpen],
  );

  const table = useTable({
    features,
    columns,
    data: list.data?.rows ?? NO_ROWS,
    rowCount: list.data?.meta.total ?? 0,
    manualSorting: true, // the server sorts (allowlisted fields)
    manualPagination: true, // the server pages
    enableSortingRemoval: false,
    state: { sorting, pagination },
    onSortingChange: (u) => {
      setSorting(u);
      resetPage();
    },
    onPaginationChange: setPagination,
  });

  const total = list.data?.meta.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pagination.pageSize));
  // Past the last page (e.g. rows archived elsewhere, or a narrower filter): snap back.
  // Guarded state adjustment during render (React's pattern for deriving state from new data),
  // not an effect: it settles in the same render pass and can't loop (pageIndex only decreases).
  if (
    list.data &&
    !list.isPlaceholderData &&
    pagination.pageIndex > 0 &&
    pagination.pageIndex >= pageCount
  ) {
    setPagination((p) => ({ ...p, pageIndex: pageCount - 1 }));
  }
  const filtered = Boolean(q) || status !== 'current' || Boolean(ownerId) || Boolean(statusId);
  const selectCls = 'rounded-md border border-slate-300 px-3 py-2';

  return (
    <section aria-labelledby="clients-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="clients-title" className="text-xl font-bold">
          {t('clients.title')}
        </h1>
        {/* Every role may create clients (ADR-019); the creator is assigned automatically. */}
        {
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800"
          >
            {t('clients.new')}
          </button>
        }
      </div>

      <div role="search" className="flex flex-wrap items-end gap-3">
        <div className="min-w-60 flex-1">
          <label htmlFor="clients-search" className="mb-1 block text-sm font-medium">
            {t('clients.searchLabel')}
          </label>
          <input
            id="clients-search"
            type="search"
            value={search}
            placeholder={t('clients.searchPlaceholder')}
            onChange={(e) => {
              setSearch(e.target.value);
              resetPage();
            }}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="clients-status" className="mb-1 block text-sm font-medium">
            {t('clients.statusFilter')}
          </label>
          <select
            id="clients-status"
            value={statusId}
            onChange={(e) => {
              setStatusId(e.target.value);
              resetPage();
            }}
            className={selectCls}
          >
            <option value="">{t('clients.statusAny')}</option>
            {(statuses.data ?? []).map((st) => (
              <option key={st.id} value={st.id}>
                {st.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="clients-lifecycle" className="mb-1 block text-sm font-medium">
            {t('clients.lifecycleFilter')}
          </label>
          <select
            id="clients-lifecycle"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as typeof status);
              resetPage();
            }}
            className={selectCls}
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {t(`clients.filter.${s}` as MessageKey)}
              </option>
            ))}
          </select>
        </div>
        {canFilterByOwner && (
          <div>
            <label htmlFor="clients-owner" className="mb-1 block text-sm font-medium">
              {t('clients.ownerFilter')}
            </label>
            <select
              id="clients-owner"
              value={ownerId}
              onChange={(e) => {
                setOwnerId(e.target.value);
                resetPage();
              }}
              className={selectCls}
            >
              <option value="">{t('clients.ownerAny')}</option>
              {(assignable.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {list.isError ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
          <p>
            {t('clients.loadError')}: {errorMessage(list.error)}
          </p>
          <button type="button" onClick={() => list.refetch()} className="mt-2 underline">
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <div
          className="overflow-x-auto rounded-lg border border-slate-200 bg-white"
          aria-busy={list.isFetching}
        >
          <table className="w-full text-sm">
            <caption className="sr-only">{t('clients.title')}</caption>
            <thead className="bg-slate-50 text-slate-600">
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header) => {
                    const sortable = SORTABLE.has(header.column.id);
                    const sorted = header.column.getIsSorted();
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        className="px-3 py-2 text-start font-medium whitespace-nowrap"
                        aria-sort={
                          sorted === 'asc'
                            ? 'ascending'
                            : sorted === 'desc'
                              ? 'descending'
                              : undefined
                        }
                      >
                        {sortable ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className="inline-flex items-center gap-1 hover:text-slate-900"
                            title={sorted === 'asc' ? t('clients.sortDesc') : t('clients.sortAsc')}
                          >
                            <table.FlexRender header={header} />
                            <span aria-hidden="true">
                              {sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : '↕'}
                            </span>
                          </button>
                        ) : (
                          <table.FlexRender header={header} />
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {list.isPending ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-3 py-8 text-center text-slate-500"
                    role="status"
                  >
                    {t('common.loading')}
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-3 py-8 text-center text-slate-500">
                    {filtered
                      ? t('clients.emptyFiltered')
                      : user.role === 'admin'
                        ? t('clients.empty')
                        : t('clients.emptyEmployee')}
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50">
                    {row.getAllCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-2 align-top">
                        <table.FlexRender cell={cell} />
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <nav
        aria-label={t('clients.pagination')}
        className="flex flex-wrap items-center justify-between gap-3 text-sm"
      >
        <span>
          {tf('clients.pageOf', { total, page: pagination.pageIndex + 1, pages: pageCount })}
        </span>
        <div className="flex items-center gap-2">
          <label htmlFor="clients-page-size">{t('clients.pageSize')}</label>
          <select
            id="clients-page-size"
            value={pagination.pageSize}
            onChange={(e) => setPagination({ pageIndex: 0, pageSize: Number(e.target.value) })}
            className="rounded-md border border-slate-300 px-2 py-1"
          >
            {[10, 20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={pagination.pageIndex === 0}
            onClick={() => setPagination((p) => ({ ...p, pageIndex: p.pageIndex - 1 }))}
            className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40"
          >
            {t('clients.prevPage')}
          </button>
          <button
            type="button"
            disabled={pagination.pageIndex + 1 >= pageCount}
            onClick={() => setPagination((p) => ({ ...p, pageIndex: p.pageIndex + 1 }))}
            className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40"
          >
            {t('clients.nextPage')}
          </button>
        </div>
      </nav>

      <Drawer open={creating} title={t('clients.new')} onClose={() => setCreating(false)}>
        <ClientForm
          onSaved={(c) => {
            setCreating(false);
            onOpen(c.id);
          }}
        />
      </Drawer>
    </section>
  );
}
