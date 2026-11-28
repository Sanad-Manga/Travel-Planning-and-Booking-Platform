import type { Metadata } from 'next';
import type { AuthUser } from '@/components/AuthProvider';
import { serverApi, type ServerResult } from '@/lib/serverApi';
import { AdminDashboardClient } from './AdminDashboardClient';
import { isActiveAdmin, isAuthorizationError, overviewPaths, type AccountsPage, type ProvidersPage, type Total } from './dashboardData';

export const metadata: Metadata = { title: 'Admin dashboard | Travel Planning and Booking Platform' };

function total(result: PromiseSettledResult<ServerResult<AccountsPage | ProvidersPage>>): Total {
  return result.status === 'fulfilled' && result.value.ok ? result.value.data.total : 'unavailable';
}

export default async function AdminPage() {
  let session: ServerResult<AuthUser>;
  try {
    session = await serverApi<AuthUser>('/api/auth/me');
  } catch (error) {
    return <AdminDashboardClient state={{ mode: isAuthorizationError(error) ? 'denied' : 'session-error' }} />;
  }

  if (!session.ok) return <AdminDashboardClient state={{ mode: 'browser' }} />;
  if (!isActiveAdmin(session.data)) return null;

  const [accounts, airlines, hotels] = await Promise.allSettled([
    serverApi<AccountsPage>(overviewPaths.accounts),
    serverApi<ProvidersPage>(overviewPaths.airlines),
    serverApi<ProvidersPage>(overviewPaths.hotels),
  ]);
  const results = [accounts, airlines, hotels];
  if (results.some((result) => result.status === 'rejected' && isAuthorizationError(result.reason))) {
    return <AdminDashboardClient state={{ mode: 'denied' }} />;
  }
  if (results.some((result) => result.status === 'fulfilled' && !result.value.ok)) {
    return <AdminDashboardClient state={{ mode: 'browser' }} />;
  }

  return (
    <AdminDashboardClient state={{
      mode: 'server',
      adminId: session.data.id,
      totals: { accounts: total(accounts), airlines: total(airlines), hotels: total(hotels) },
    }} />
  );
}
