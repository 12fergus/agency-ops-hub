import type { ReactNode } from 'react';
import { t, type MessageKey } from '@/lib/i18n';

const NAV_ITEMS: MessageKey[] = [
  'nav.dashboard',
  'nav.clients',
  'nav.leads',
  'nav.tasks',
  'nav.campaigns',
  'nav.settings',
];

/** RTL shell: navigation is the first flex child, so it renders on the right in dir="rtl". */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full">
      <aside className="w-56 shrink-0 border-e border-slate-200 bg-white">
        <div className="px-4 py-4 text-lg font-bold">{t('app.name')}</div>
        <nav aria-label={t('nav.label')}>
          <ul className="space-y-1 px-2">
            {NAV_ITEMS.map((key) => (
              <li key={key}>
                <span
                  aria-disabled="true"
                  className="flex items-center justify-between rounded-md px-3 py-2 text-slate-400"
                >
                  {t(key)}
                  <span className="text-xs">{t('nav.comingSoon')}</span>
                </span>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center border-b border-slate-200 bg-white px-4" />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
