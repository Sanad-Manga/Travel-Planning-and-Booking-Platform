import { adminProvidersPath } from '@/api/admin';
import { withQuery, type ResponseOf } from '@/api/types';
import type { AuthUser } from '@/components/AuthProvider';
import { ApiError } from '@/lib/api';

const pagination = { page: 1, limit: 1 };

export const overviewPaths = {
  accounts: withQuery('/api/admin/accounts', pagination),
  airlines: withQuery(adminProvidersPath, { type: 'airline', ...pagination }),
  hotels: withQuery(adminProvidersPath, { type: 'hotel', ...pagination }),
};

export type AccountsPage = ResponseOf<'/api/admin/accounts'>;
export type ProvidersPage = ResponseOf<typeof adminProvidersPath>;
export type Total = number | 'loading' | 'unavailable';
export type Overview = Record<keyof typeof overviewPaths, Total>;

export type DashboardState =
  | { mode: 'server'; adminId: string; totals: Overview }
  | { mode: 'browser' | 'denied' | 'session-error' };

export function isActiveAdmin(user: AuthUser | null): user is AuthUser {
  return user?.role === 'ADMIN' && user.status === 'ACTIVE' && !user.mustChangePassword;
}

export function isAuthorizationError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}
