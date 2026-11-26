import type { Metadata } from 'next';
import { ComingSoon } from '@/components/ComingSoon';
import { RequireRole } from '@/components/RequireRole';

export const metadata: Metadata = { title: 'My bookings | Travel Planning and Booking Platform' };

export default function BookingsPage() {
  return (
    <RequireRole roles={['USER']}>
      <ComingSoon title="My bookings" description="Your flight and hotel bookings." />
    </RequireRole>
  );
}
