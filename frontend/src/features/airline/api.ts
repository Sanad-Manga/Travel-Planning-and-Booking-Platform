import { api } from '@/lib/api';
import type { BodyOf, ResponseOf } from '@/api/types';

export type CreateFlightBody = BodyOf<'/api/flights', 'post'>;
export type FlightCreated = ResponseOf<'/api/flights', 'post'>;

/** FLT-03: the airline moderator creates a flight for their own airline. Times are LOCAL to each airport. */
export function createFlight(body: CreateFlightBody): Promise<FlightCreated> {
  return api<FlightCreated>('/api/flights', { method: 'POST', body });
}
