import type { Metadata } from 'next';
import { RequireRole } from '@/components/RequireRole';
import { NewItinerary } from '@/features/itineraries/components/NewItinerary';

export const metadata: Metadata = { title: 'New itinerary | Travel Planning and Booking Platform' };

export default function NewItineraryPage() {
  return (
    <RequireRole roles={['USER']}>
      <NewItinerary />
    </RequireRole>
  );
}
