import { api } from '@/lib/api';
import type { BodyOf, QueryOf, ResponseOf } from './types';

export const adminAccountsPath = '/api/admin/accounts';
export type Account = ResponseOf<typeof adminAccountsPath>['items'][number];
export type AccountFilters = Pick<QueryOf<typeof adminAccountsPath>, 'search' | 'role' | 'status'>;
export type PasswordReset = ResponseOf<'/api/admin/users/{id}/reset-password', 'post'>;

export function suspendAccount(id: string) {
  return api<ResponseOf<'/api/admin/accounts/{id}/suspend', 'patch'>>(
    `${adminAccountsPath}/${encodeURIComponent(id)}/suspend`, { method: 'PATCH', retryOn401: false },
  );
}

export function reactivateAccount(id: string) {
  return api<ResponseOf<'/api/admin/accounts/{id}/reactivate', 'patch'>>(
    `${adminAccountsPath}/${encodeURIComponent(id)}/reactivate`, { method: 'PATCH', retryOn401: false },
  );
}

export function resetAccountPassword(id: string) {
  return api<PasswordReset>(`/api/admin/users/${encodeURIComponent(id)}/reset-password`, {
    method: 'POST', retryOn401: false,
  });
}

export const adminProvidersPath = '/api/admin/providers';
export type Provider = ResponseOf<typeof adminProvidersPath>['items'][number];
export type ProviderQuery = QueryOf<typeof adminProvidersPath>;
export type CreateModeratorBody = BodyOf<'/api/admin/moderators', 'post'>;
export type CreatedModerator = ResponseOf<'/api/admin/moderators', 'post'>;

export function createModerator(body: CreateModeratorBody): Promise<CreatedModerator> {
  return api('/api/admin/moderators', { method: 'POST', body, retryOn401: false });
}
