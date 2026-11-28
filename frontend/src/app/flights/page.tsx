import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { PageHeader } from '@/components/PageHeader';
import { Spinner } from '@/components/Spinner';
import { FlightSearch } from '@/features/flights/FlightSearch';

export const metadata: Metadata = { title: 'Flights | Travel Planning and Booking Platform' };

export default function FlightsPage() {
  return (
    <>
      <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Flights' }]} />
      <PageHeader
        title="Flights"
        description="Search one-way and round-trip flights, compare fares and choose the one that fits."
      />
      {/* useSearchParams needs a Suspense boundary in the App Router. */}
      <Suspense fallback={<Spinner label="Loading flight search" />}>
        <FlightSearch />
      </Suspense>
    </>
  );
}
