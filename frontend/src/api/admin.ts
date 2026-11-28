import { api } from '@/lib/api';
import type { BodyOf, QueryOf, ResponseOf } from './types';

export const adminProvidersPath = '/api/admin/providers';
export type Provider = ResponseOf<typeof adminProvidersPath>['items'][number];
export type ProviderQuery = QueryOf<typeof adminProvidersPath>;
export type CreateModeratorBody = BodyOf<'/api/admin/moderators', 'post'>;
export type CreatedModerator = ResponseOf<'/api/admin/moderators', 'post'>;

export function createModerator(body: CreateModeratorBody): Promise<CreatedModerator> {
  return api('/api/admin/moderators', { method: 'POST', body, retryOn401: false });
}

export type ProviderType = ProviderQuery['type'];

export function deactivateProvider(type: ProviderType, id: string): Promise<ResponseOf<'/api/admin/providers/{type}/{id}/deactivate', 'patch'>> {
  return api(`${adminProvidersPath}/${type}/${encodeURIComponent(id)}/deactivate`, { method: 'PATCH', retryOn401: false });
}

export function reactivateProvider(type: ProviderType, id: string): Promise<ResponseOf<'/api/admin/providers/{type}/{id}/reactivate', 'patch'>> {
  return api(`${adminProvidersPath}/${type}/${encodeURIComponent(id)}/reactivate`, { method: 'PATCH', retryOn401: false });
}
