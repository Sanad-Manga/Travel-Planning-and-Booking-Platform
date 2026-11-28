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
