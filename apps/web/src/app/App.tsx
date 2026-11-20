import { AppShell } from '@/components/AppShell';
import { SystemStatus } from '@/features/system/SystemStatus';

export function App() {
  return (
    <AppShell>
      <SystemStatus />
    </AppShell>
  );
}
