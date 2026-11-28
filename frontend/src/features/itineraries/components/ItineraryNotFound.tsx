import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { ApiError } from '@/lib/api';

/** A missing itinerary, someone else's (the API answers 404 for both, ACC-11) or an address that is not an id (400). */
export function isMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.statusCode === 404 || error.statusCode === 400);
}

export function ItineraryNotFound() {
  return (
    <>
      <PageHeader title="Itinerary not found" />
      <EmptyState
        title="We couldn’t find that itinerary."
        description="It may have been deleted, or it belongs to someone else."
        action={{ label: 'Back to my itineraries', href: '/itineraries' }}
      />
    </>
  );
}
