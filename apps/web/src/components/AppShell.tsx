import type { ReactNode } from 'react';
import type { UserDto } from '@agency-crm/shared';
import { t, type MessageKey } from '@/lib/i18n';

const COMING_SOON: MessageKey[] = [
  'nav.dashboard',
  'nav.clients',
  'nav.leads',
  'nav.tasks',
  'nav.campaigns',
];

interface Props {
  user: UserDto;
  route: string;
  onNavigate: (route: string) => void;
  onLogout: () => void;
  children: ReactNode;
}

/** RTL shell: navigation is the first flex child, so it renders on the right in dir="rtl". */
export function AppShell({ user, route, onNavigate, onLogout, children }: Props) {
  const link = (target: string, label: MessageKey) => (
    <li>
      <a
        href={`#/${target}`}
        aria-current={route === target ? 'page' : undefined}
        onClick={(e) => {
          e.preventDefault();
          onNavigate(target);
        }}
        className={`block rounded-md px-3 py-2 ${
          route === target ? 'bg-blue-50 font-medium text-blue-800' : 'hover:bg-slate-50'
        }`}
      >
        {t(label)}
      </a>
    </li>
  );

  return (
    <div className="flex h-full">
      <aside className="w-56 shrink-0 border-e border-slate-200 bg-white">
        <div className="px-4 py-4 text-lg font-bold">{t('app.name')}</div>
        <nav aria-label={t('nav.label')}>
          <ul className="space-y-1 px-2">
            {link('', 'nav.home')}
            {user.role === 'admin' && link('users', 'nav.users')}
            {COMING_SOON.map((key) => (
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
        <header className="flex h-14 items-center justify-end gap-3 border-b border-slate-200 bg-white px-4 text-sm">
          <span>
            {t('auth.signedInAs')}
            <strong>{user.displayName}</strong> · {t(`role.${user.role}` as MessageKey)}
          </span>
          <button
            type="button"
            onClick={onLogout}
            className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50"
          >
            {t('auth.logout')}
          </button>
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
