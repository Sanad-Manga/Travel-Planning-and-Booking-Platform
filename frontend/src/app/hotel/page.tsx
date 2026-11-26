import type { Metadata } from 'next';
import { ComingSoon } from '@/components/ComingSoon';
import { RequireRole } from '@/components/RequireRole';

export const metadata: Metadata = { title: 'Hotel | Travel Planning and Booking Platform' };

export default function HotelPage() {
  return (
    <RequireRole roles={['HOTEL_MODERATOR']}>
      <ComingSoon title="Hotel" description="Manage your hotel, rooms and reservations." />
    </RequireRole>
  );
}
