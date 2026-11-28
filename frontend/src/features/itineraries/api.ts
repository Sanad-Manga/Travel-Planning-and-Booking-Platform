import type { BodyOf, ResponseOf, Schema } from '@/api/types';
import { api } from '@/lib/api';

export type ItineraryRow = ResponseOf<'/api/itineraries'>['items'][number];
export type Itinerary = Schema<'ItineraryResponseDto'>;
export type Visibility = Itinerary['visibility'];
export type CreateItineraryBody = BodyOf<'/api/itineraries', 'post'>;
export type UpdateItineraryBody = BodyOf<'/api/itineraries/{id}', 'patch'>;

export const ITINERARIES_PATH = '/api/itineraries';
export const itineraryPath = (id: string) => `${ITINERARIES_PATH}/${encodeURIComponent(id)}`;

/** ITN-01: a new itinerary is private until its owner shares it. */
export function createItinerary(body: CreateItineraryBody): Promise<Itinerary> {
  return api<Itinerary>(ITINERARIES_PATH, { method: 'POST', body });
}

/** ITN-01 (title, countries, start date) and ITN-20 (visibility). Send only what changes. */
export function updateItinerary(id: string, body: UpdateItineraryBody): Promise<Itinerary> {
  return api<Itinerary>(itineraryPath(id), { method: 'PATCH', body });
}

export function deleteItinerary(id: string): Promise<void> {
  return api<void>(itineraryPath(id), { method: 'DELETE' });
}
