import { useQuery } from '@tanstack/react-query';
import type { Health } from '@agency-crm/shared';
import { apiGet } from '@/lib/api';
import { formatDateTime, t } from '@/lib/i18n';

export function SystemStatus() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['health'],
    queryFn: () => apiGet<Health>('/health'),
    retry: false,
  });

  let text: string;
  let tone: string;
  if (isPending) {
    text = t('system.loading');
    tone = 'text-slate-500';
  } else if (isError) {
    text = t('system.error');
    tone = 'text-red-700';
  } else if (data.data.status === 'ok') {
    text = t('system.ok');
    tone = 'text-emerald-700';
  } else {
    text = t('system.degraded');
    tone = 'text-amber-700';
  }

  return (
    <section
      aria-labelledby="system-status-title"
      className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 id="system-status-title" className="mb-2 text-lg font-semibold">
        {t('system.title')}
      </h2>
      <p role="status" className={tone}>
        {text}
      </p>
      {data && (
        <p className="mt-1 text-sm text-slate-500">
          {t('system.version')} <span dir="ltr">{data.data.version}</span> · {t('system.checkedAt')}
          <span dir="ltr">{formatDateTime(data.data.time)}</span>
        </p>
      )}
    </section>
  );
}
