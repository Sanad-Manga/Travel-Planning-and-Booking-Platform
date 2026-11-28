'use client';

import { useRouter } from 'next/navigation';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/ToastProvider';
import { createItinerary } from '../api';
import { EMPTY_ITINERARY } from '../itineraryForm';
import { ItineraryForm } from './ItineraryForm';

/** ITN-01: /itineraries/new. */
export function NewItinerary() {
  const router = useRouter();
  const toast = useToast();
  return (
    <>
      <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Itineraries', href: '/itineraries' }, { label: 'New itinerary' }]} />
      <PageHeader title="New itinerary" description="Name your trip and say where and when it starts. It stays private until you share it." />
      <ItineraryForm
        defaultValues={EMPTY_ITINERARY}
        submitLabel="Create itinerary"
        submittingLabel="Creating itinerary…"
        cancelHref="/itineraries"
        startDateHint="Each day you add is dated from this one."
        leavesOnSave
        onSave={async (values) => {
          await createItinerary(values);
          toast.success('Itinerary created. Only you can see it.');
          router.push('/itineraries');
        }}
      />
    </>
  );
}
