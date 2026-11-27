import type { Metadata } from 'next';
import { Checkout } from '@/components/Checkout';
import { RequireRole } from '@/components/RequireRole';

export const metadata: Metadata = { title: 'Checkout | Travel Planning and Booking Platform', robots: { index: false } };

export default async function FlightCheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="page">
      <RequireRole roles={['USER']}>
        <Checkout type="flight" bookingId={id} />
      </RequireRole>
    </div>
  );
}
