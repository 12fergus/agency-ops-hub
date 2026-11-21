import { AppShell } from '@/components/AppShell';
import { LoginPage } from '@/features/auth/LoginPage';
import { SignupPage } from '@/features/auth/SignupPage';
import { useCurrentUser, useLogout, useSetupStatus } from '@/features/auth/session';
import { SetupPage } from '@/features/auth/SetupPage';
import { SystemStatus } from '@/features/system/SystemStatus';
import { UsersPage } from '@/features/users/UsersPage';
import { errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useHashRoute } from '@/lib/useHashRoute';

export function App() {
  const me = useCurrentUser();
  const setupStatus = useSetupStatus();
  const logout = useLogout();
  const [route, navigate] = useHashRoute();

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
  return (
    <AppShell user={user} route={route} onNavigate={navigate} onLogout={() => logout.mutate()}>
      {route === 'users' && user.role === 'admin' ? (
        <UsersPage currentUserId={user.id} />
      ) : (
        <SystemStatus />
      )}
    </AppShell>
  );
}
