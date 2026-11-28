import type { Metadata } from 'next';
import { RequireRole } from '@/components/RequireRole';
import { EditItinerary } from '@/features/itineraries/components/EditItinerary';

export const metadata: Metadata = { title: 'Edit itinerary | Travel Planning and Booking Platform' };

export default async function EditItineraryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequireRole roles={['USER']}>
      <EditItinerary id={id} />
    </RequireRole>
  );
}
