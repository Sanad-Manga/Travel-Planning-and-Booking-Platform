import type { Metadata } from 'next';
import { RequireRole } from '@/components/RequireRole';
import { ItineraryList } from '@/features/itineraries/components/ItineraryList';

export const metadata: Metadata = { title: 'My itineraries | Travel Planning and Booking Platform' };

/** ITN-03: /itineraries, for travellers. */
export default function ItinerariesPage() {
  return (
    <RequireRole roles={['USER']}>
      <ItineraryList />
    </RequireRole>
  );
}
