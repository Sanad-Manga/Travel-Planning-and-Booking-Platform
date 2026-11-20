import type { Metadata } from 'next';
import { ComingSoon } from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Flights | Travel Planning and Booking Platform' };

export default function FlightsPage() {
  return <ComingSoon title="Flights" />;
}
