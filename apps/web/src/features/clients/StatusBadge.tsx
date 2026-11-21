import type { ClientDto, StatusColor } from '@agency-crm/shared';
import { t } from '@/lib/i18n';

/** Vetted classes per palette key (contrast-checked pairs; no free CSS from the server). */
const STATUS_COLOR_CLASSES: Record<StatusColor, string> = {
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
  gray: 'bg-slate-100 text-slate-700 ring-slate-300',
  amber: 'bg-amber-50 text-amber-800 ring-amber-300',
  blue: 'bg-blue-50 text-blue-800 ring-blue-300',
  red: 'bg-red-50 text-red-800 ring-red-300',
  purple: 'bg-violet-50 text-violet-800 ring-violet-300',
  teal: 'bg-teal-50 text-teal-800 ring-teal-300',
  pink: 'bg-pink-50 text-pink-800 ring-pink-300',
};

/** Colored badge for an admin-defined status. The name is always shown (color is not the only cue). */
export function ColorBadge({ name, color }: { name: string; color: StatusColor }) {
  return (
    <span
      data-color={color}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${STATUS_COLOR_CLASSES[color]}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {name}
    </span>
  );
}

/** The client's status badge, plus an "archived" badge when archived. */
export function StatusBadge({ client }: { client: Pick<ClientDto, 'status' | 'clientStatus'> }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {client.clientStatus && (
        <ColorBadge name={client.clientStatus.name} color={client.clientStatus.color} />
      )}
      {client.status === 'archived' && (
        <ColorBadge name={t('clients.status.archived')} color="gray" />
      )}
    </span>
  );
}
