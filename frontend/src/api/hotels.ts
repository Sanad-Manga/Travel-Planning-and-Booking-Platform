import { api } from '@/lib/api';
import type { BodyOf, ResponseOf } from './types';

export type CreateHotelBody = BodyOf<'/api/hotels', 'post'>;

export function createHotel(body: CreateHotelBody): Promise<ResponseOf<'/api/hotels', 'post'>> {
  return api('/api/hotels', { method: 'POST', body, retryOn401: false });
}
