'use client';

import { useRouter } from 'next/navigation';
import { useApi } from '@/api/useApi';
import { Alert } from '@/components/Alert';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { Card } from '@/components/Card';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';
import { Spinner } from '@/components/Spinner';
import { useToast } from '@/components/ToastProvider';
import { toFriendlyError } from '@/lib/apiError';
import { itineraryPath, updateItinerary, type Itinerary } from '../api';
import { useItineraryActions } from '../useItineraryActions';
import { ItineraryForm } from './ItineraryForm';
import { ItineraryNotFound, isMissing } from './ItineraryNotFound';
import { VisibilityBadge } from './VisibilityBadge';

const crumbs = (current: string) => [{ label: 'Home', href: '/' }, { label: 'Itineraries', href: '/itineraries' }, { label: current }];

/** ITN-01 and ITN-20: edit the basics, share or unshare, and delete one itinerary. */
export function EditItinerary({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const { busyId, toggleVisibility, remove } = useItineraryActions();
  const { data, error, isLoading, mutate } = useApi<Itinerary>(itineraryPath(id));

  if (error && isMissing(error)) return <ItineraryNotFound />;
  if (isLoading) {
    return (
      <>
        <Spinner label="Loading itinerary" />
        <Skeleton lines={4} />
      </>
    );
  }
  if (!data) {
    const friendly = toFriendlyError(error);
    return (
      <Alert variant="error" hint={friendly.hint} onRetry={() => void mutate()}>
        {friendly.message}
      </Alert>
    );
  }

  return (
    <>
      <Breadcrumbs items={crumbs(data.title)} />
      <PageHeader title="Edit itinerary" description="Change the basics, choose who can see it, or delete it." />
      <div className="itinerary-sections">
        <Card title="Basics">
          <ItineraryForm
            // A form reads its values once. Remounting when the SAVED basics change stops it from sending stale
            // cached values back; sharing changes do not remount it, so typed edits survive them.
            key={JSON.stringify([data.title, data.countryCodes, data.startDate])}
            defaultValues={{ title: data.title, countryCodes: data.countryCodes, startDate: data.startDate }}
            submitLabel="Save changes"
            submittingLabel="Saving…"
            cancelHref="/itineraries"
            startDateHint="Changing it moves the date of every day."
            onSave={async (values) => {
              const saved = await updateItinerary(id, values);
              await mutate(saved, { revalidate: false });
              toast.success('Itinerary saved.');
            }}
          />
        </Card>
        <Card title="Sharing">
          <p>
            <VisibilityBadge visibility={data.visibility} isHidden={data.isHidden} />
          </p>
          <p>
            {data.isHidden
              ? 'An admin hid this itinerary. Only you and admins can see it.'
              : data.visibility === 'PUBLIC'
                ? 'Anyone can find and read this itinerary. Only you can change it.'
                : 'Only you can see this itinerary.'}
          </p>
          <button type="button" className="btn" disabled={busyId === id} onClick={() => void toggleVisibility(data, () => mutate())}>
            {data.visibility === 'PUBLIC' ? 'Make private' : 'Make public'}
          </button>
        </Card>
        <Card title="Delete">
          <p>Deleting removes the itinerary with its days, activities and budget. It cannot be undone.</p>
          <button type="button" className="btn btn-danger" onClick={() => void remove(data, () => router.push('/itineraries'))}>
            Delete itinerary
          </button>
        </Card>
      </div>
    </>
  );
}
