import type { Metadata } from 'next';
import { ComingSoon } from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Itineraries | Travel Planning and Booking Platform' };

export default function ItinerariesPage() {
  return <ComingSoon title="Itineraries" description="Plan your trip day by day." />;
}
