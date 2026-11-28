import { api } from '@/lib/api';
import type { BodyOf, ResponseOf } from './types';

export type CreateAirlineBody = BodyOf<'/api/airlines', 'post'>;

export function createAirline(body: CreateAirlineBody): Promise<ResponseOf<'/api/airlines', 'post'>> {
  return api('/api/airlines', { method: 'POST', body, retryOn401: false });
}
