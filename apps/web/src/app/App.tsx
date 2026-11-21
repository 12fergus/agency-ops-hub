import { useCallback } from 'react';
import { AppShell } from '@/components/AppShell';
import { LoginPage } from '@/features/auth/LoginPage';
import { SignupPage } from '@/features/auth/SignupPage';
import { useCurrentUser, useLogout, useSetupStatus } from '@/features/auth/session';
import { SetupPage } from '@/features/auth/SetupPage';
import { SystemStatus } from '@/features/system/SystemStatus';
import { UsersPage } from '@/features/users/UsersPage';
import { ClientDetailPage } from '@/features/clients/ClientDetailPage';
import { ClientsPage } from '@/features/clients/ClientsPage';
import { TasksPage } from '@/features/work/TasksPage';
import { StatusesSettings } from '@/features/client-statuses/StatusesSettings';
import { errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useHashRoute } from '@/lib/useHashRoute';

export function App() {
  const me = useCurrentUser();
  const setupStatus = useSetupStatus();
  const logout = useLogout();
  const [route, navigate] = useHashRoute();
  // Stable callback for the clients table columns (memoized there).
  const openClient = useCallback(
    (id: string) => navigate(`clients/${encodeURIComponent(id)}`),
    [navigate],
  );

  if (me.isPending || (!me.data && setupStatus.isPending)) {
    return <p className="p-6">{t('common.loading')}</p>;
  }
  if (me.isError) {
    return (
      <p role="alert" className="p-6 text-red-700">
        {errorMessage(me.error)}
      </p>
    );
  }
  if (!me.data) {
    // Brand-new installation without any admin: first-run setup instead of login/sign-up.
    if (setupStatus.data?.needsSetup) return <SetupPage />;
    return route === 'signup' ? (
      <SignupPage onLogin={() => navigate('')} />
    ) : (
      <LoginPage onSignup={() => navigate('signup')} />
    );
  }

  const user = me.data;
  const [section, rawParam] = route.split('/');
  const param = rawParam ? safeDecode(rawParam) : undefined;

  function renderRoute() {
    if (section === 'users' && user.role === 'admin') return <UsersPage currentUserId={user.id} />;
    if (section === 'settings' && user.role === 'admin') return <StatusesSettings />;
    if (section === 'clients' && param) {
      return (
        <ClientDetailPage key={param} id={param} user={user} onBack={() => navigate('clients')} />
      );
    }
    if (section === 'tasks') return <TasksPage user={user} onOpenClient={openClient} />;
    if (section === 'clients') {
      return <ClientsPage user={user} onOpen={openClient} />;
    }
    return <SystemStatus />;
  }

  return (
    <AppShell user={user} route={route} onNavigate={navigate} onLogout={() => logout.mutate()}>
      {renderRoute()}
    </AppShell>
  );
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
