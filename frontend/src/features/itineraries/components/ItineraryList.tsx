'use client';

import Link from 'next/link';
import { usePaginated } from '@/api/usePaginated';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { DataTable, type TableColumn } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { ITINERARIES_PATH, type ItineraryRow } from '../api';
import { formatCalendarDate, formatDayCount } from '../format';
import { useCountries } from '../useCountries';
import { useItineraryActions } from '../useItineraryActions';
import { VisibilityBadge } from './VisibilityBadge';

/** ITN-03: my itineraries, most recently updated first (the server's order), ten per page. */
export function ItineraryList() {
  const list = usePaginated<ItineraryRow>(ITINERARIES_PATH);
  const { nameOf } = useCountries();
  const { busyId, toggleVisibility, remove } = useItineraryActions();
  const isEmpty = !list.error && list.data?.total === 0;

  const columns: TableColumn<ItineraryRow>[] = [
    {
      id: 'title',
      header: 'Title',
      cell: (row) => (
        <Link className="itinerary-title-link" href={`/itineraries/${row.id}/edit`}>
          {row.title}
        </Link>
      ),
    },
    { id: 'countries', header: 'Countries', cell: (row) => row.countryCodes.map(nameOf).join(', ') },
    { id: 'start', header: 'Starts', cell: (row) => <span className="nowrap">{formatCalendarDate(row.startDate)}</span> },
    { id: 'days', header: 'Length', cell: (row) => <span className="nowrap">{formatDayCount(row.dayCount)}</span> },
    { id: 'visibility', header: 'Visibility', cell: (row) => <VisibilityBadge visibility={row.visibility} isHidden={row.isHidden} /> },
    {
      id: 'actions',
      header: 'Actions',
      cell: (row) => (
        <div className="row-actions">
          <Link className="btn btn-sm" href={`/itineraries/${row.id}/edit`} aria-label={`Edit: ${row.title}`}>
            Edit
          </Link>
          <button
            type="button"
            className="btn btn-sm"
            aria-label={`Make ${row.visibility === 'PUBLIC' ? 'private' : 'public'}: ${row.title}`}
            disabled={busyId === row.id}
            onClick={() => void toggleVisibility(row, list.revalidate)}
          >
            {row.visibility === 'PUBLIC' ? 'Make private' : 'Make public'}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-quiet-danger"
            aria-label={`Delete: ${row.title}`}
            onClick={() => void remove(row, list.revalidate)}
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Itineraries' }]} />
      <PageHeader
        title="My itineraries"
        description="Plan each trip day by day. Your most recently changed trip is first."
        action={
          isEmpty ? undefined : (
            <Link className="btn btn-primary" href="/itineraries/new">
              New itinerary
            </Link>
          )
        }
      />
      {isEmpty ? (
        <EmptyState
          title="No itineraries yet"
          description="Create one, then add your days, cities and plans."
          action={{ label: 'Create itinerary', href: '/itineraries/new' }}
        />
      ) : (
        <div className="itinerary-table">
          <DataTable
            caption="Your itineraries"
            columns={columns}
            rows={list.items}
            rowKey={(row) => row.id}
            isLoading={list.isLoading}
            error={list.error}
            onRetry={() => void list.revalidate()}
          />
        </div>
      )}
      {list.data && !list.error && list.data.totalPages > 1 ? <Pagination {...list.data} onPageChange={list.setPage} /> : null}
    </>
  );
}
