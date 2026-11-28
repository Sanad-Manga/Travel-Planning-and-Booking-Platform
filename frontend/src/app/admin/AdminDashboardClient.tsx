'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { SWRConfig } from 'swr';
import { useApi } from '@/api/useApi';
import { Alert } from '@/components/Alert';
import { useAuth } from '@/components/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { AdminDashboard } from './AdminDashboard';
import { isActiveAdmin, isAuthorizationError, overviewPaths, type AccountsPage, type DashboardState, type ProvidersPage, type Total } from './dashboardData';
import styles from './admin.module.css';

function DashboardError({ retry, pending }: { retry?: () => void; pending?: boolean }) {
  return (
    <div className={styles.dashboard}>
      <PageHeader title="Admin dashboard" />
      <Alert variant="error" onRetry={pending ? undefined : retry}>
        {retry ? 'The dashboard session could not be verified.' : 'Dashboard totals are unavailable for this session.'}
      </Alert>
      {pending && <p className="field-hint" role="status">Refreshing dashboard…</p>}
    </div>
  );
}

function BrowserOverview({ name }: { name: string }) {
  const accounts = useApi<AccountsPage>(overviewPaths.accounts);
  const airlines = useApi<ProvidersPage>(overviewPaths.airlines);
  const hotels = useApi<ProvidersPage>(overviewPaths.hotels);
  const requests = [accounts, airlines, hotels];

  if (requests.some(({ error }) => isAuthorizationError(error))) return <DashboardError />;

  function total(request: typeof requests[number]): Total {
    if (request.isLoading) return 'loading';
    if (request.error) return 'unavailable';
    return request.data?.total ?? 'unavailable';
  }

  return (
    <AdminDashboard name={name} totals={{ accounts: total(accounts), airlines: total(airlines), hotels: total(hotels) }}
      pending={requests.some(({ isValidating, isLoading }) => isValidating && !isLoading)}
      retry={() => {
        for (const request of requests) if (request.error) void request.mutate();
      }} />
  );
}

const dashboardCache = { provider: () => new Map() };

export function AdminDashboardClient({ state }: { state: DashboardState }) {
  const { user } = useAuth();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const retry = () => startTransition(() => router.refresh());

  if (!isActiveAdmin(user)) return null;
  if (state.mode === 'denied') return <DashboardError />;
  if (state.mode === 'session-error') return <DashboardError pending={pending} retry={retry} />;
  if (state.mode === 'server' && state.adminId === user.id) {
    return <AdminDashboard name={user.name} totals={state.totals} pending={pending} retry={retry} />;
  }

  return (
    <SWRConfig key={user.id} value={dashboardCache}>
      <BrowserOverview name={user.name} />
    </SWRConfig>
  );
}
