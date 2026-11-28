import type { Metadata } from 'next';
import { RequireRole } from '@/components/RequireRole';
import { CreateFlightForm } from '@/features/airline/components/CreateFlightForm';

export const metadata: Metadata = { title: 'New flight | Travel Planning and Booking Platform' };

export default function NewFlightPage() {
  return (
    <RequireRole roles={['AIRLINE_MODERATOR']}>
      <CreateFlightForm />
    </RequireRole>
  );
}
