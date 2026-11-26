import type { Metadata } from 'next';
import { ComingSoon } from '@/components/ComingSoon';
import { RequireRole } from '@/components/RequireRole';

export const metadata: Metadata = { title: 'Airline | Travel Planning and Booking Platform' };

export default function AirlinePage() {
  return (
    <RequireRole roles={['AIRLINE_MODERATOR']}>
      <ComingSoon title="Airline" description="Manage your airline, flights and bookings." />
    </RequireRole>
  );
}
