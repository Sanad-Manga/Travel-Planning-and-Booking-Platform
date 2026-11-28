'use client';

import { useMemo } from 'react';
import {
  flightSearchKey,
  isRoundTripResponse,
  type FlightSearchPage,
  type FlightSearchQuery,
  type FlightSearchResponse,
} from '@/api/flights';
import { useApi } from '@/api/useApi';
import { Alert } from '@/components/Alert';
import { EmptyState } from '@/components/EmptyState';
import { emptyMessages } from '@/components/emptyMessages';
import { Pagination } from '@/components/Pagination';
import { Skeleton } from '@/components/Skeleton';
import { Spinner } from '@/components/Spinner';
import { toFriendlyError } from '@/lib/apiError';
import { formatInZone } from '@/lib/formatInZone';
import { FlightResultCard } from './FlightResultCard';
import { ResultsFilters } from './ResultsFilters';
import { SearchForm } from './SearchForm';
import { formFromQuery, PAGE_SIZE, searchValuesToQuery, type SearchFormValues } from './searchParams';

export interface FlightSearchPanelProps {
  /** The search in the address bar, or null on `/flights` before the first search. */
  query: FlightSearchQuery | null;
  /** Writes the next search, filter change or page change. The page turns this into a URL. */
  onQueryChange: (query: FlightSearchQuery) => void;
}

/**
 * FLT-11 / FLT-12 / FLT-15: the whole flight-search screen without depending on the router, so the
 * itinerary flights tab can reuse it with its own state. The page wraps it with the URL-synced
 * `FlightSearch`, which keeps every search shareable and reachable with the Back button.
 */
export function FlightSearchPanel({ query, onQueryChange }: FlightSearchPanelProps) {
  const key = query ? flightSearchKey(query) : null;
  const { data, error, isLoading, mutate } = useApi<FlightSearchResponse>(key);

  const form = useMemo(() => formFromQuery(query), [query]);
  const formKey = [
    form.departureAirport,
    form.arrivalAirport,
    form.departureDate,
    form.returnDate,
    form.passengers,
    form.cabinClass,
  ].join('|');

  function search(values: SearchFormValues) {
    onQueryChange(searchValuesToQuery(values));
  }

  return (
    <div className="flight-search">
      <section className="card flight-search-card" aria-labelledby="flight-search-heading">
        <h2 id="flight-search-heading" className="card-title">
          Search flights
        </h2>
        <SearchForm key={formKey} initial={form} onSearch={search} />
      </section>

      {!query ? (
        <section className="card flight-intro" aria-labelledby="flight-intro-heading">
          <h2 id="flight-intro-heading" className="card-title">
            Compare flights in one place
          </h2>
          <p>
            Choose where you are flying from and to, then pick a date. Add a return date for a round trip, or leave it empty
            for a one-way flight.
          </p>
          <p className="field-hint">Times are shown in each airport&apos;s own time zone and fares are per passenger.</p>
        </section>
      ) : error ? (
        <FlightResultsError error={error} onRetry={() => void mutate()} />
      ) : isLoading ? (
        <FlightResultsLoading />
      ) : data ? (
        <FlightResults query={query} data={data} onQueryChange={onQueryChange} />
      ) : null}
    </div>
  );
}

function FlightResults({
  query,
  data,
  onQueryChange,
}: {
  query: FlightSearchQuery;
  data: FlightSearchResponse;
  onQueryChange: (query: FlightSearchQuery) => void;
}) {
  const roundTrip = isRoundTripResponse(data);
  const outbound = roundTrip ? data.outbound : data;
  const inbound = roundTrip ? data.return : null;
  const totalPages = roundTrip ? Math.max(data.outbound.totalPages, data.return.totalPages) : outbound.totalPages;
  const empty = outbound.items.length === 0 && (!inbound || inbound.items.length === 0);

  return (
    <section className="flight-results" aria-labelledby="flight-results-heading">
      <div className="flight-results-header">
        <div>
          <h2 id="flight-results-heading" className="flight-results-title">
            {query.departureAirport} <span aria-hidden="true">&#8594;</span> {query.arrivalAirport}
          </h2>
          <p className="flight-results-summary">
            {formatDate(query.departureDate)}
            {query.returnDate ? ` – ${formatDate(query.returnDate)}` : ''} · {query.passengers}{' '}
            {query.passengers === 1 ? 'passenger' : 'passengers'} · {roundTrip ? 'Round trip' : 'One way'}
          </p>
        </div>
        <p className="flight-results-count" aria-live="polite">
          {roundTrip ? `${outbound.total} outbound · ${data.return.total} return` : `${outbound.total} flights`}
        </p>
      </div>

      <ResultsFilters
        key={`${query.minPrice ?? ''}-${query.maxPrice ?? ''}-${query.sort}-${query.order}`}
        query={query}
        onApply={onQueryChange}
      />

      {empty ? (
        <EmptyState {...emptyMessages.flightSearch} />
      ) : (
        <>
          <FlightSection
            title={roundTrip ? 'Outbound flights' : 'Flights'}
            description={roundTrip ? `${query.departureAirport} to ${query.arrivalAirport} on ${formatDate(query.departureDate)}` : undefined}
            page={outbound}
            passengers={query.passengers}
          />
          {inbound ? (
            <FlightSection
              title="Return flights"
              description={`${query.arrivalAirport} to ${query.departureAirport} on ${formatDate(query.returnDate ?? '')}`}
              page={inbound}
              passengers={query.passengers}
            />
          ) : null}

          <Pagination
            page={query.page ?? 1}
            totalPages={totalPages}
            limit={query.limit ?? PAGE_SIZE}
            total={roundTrip ? undefined : outbound.total}
            onPageChange={(page) => onQueryChange({ ...query, page })}
          />
        </>
      )}
    </section>
  );
}

function FlightSection({
  title,
  description,
  page,
  passengers,
}: {
  title: string;
  description?: string;
  page: FlightSearchPage;
  passengers: number;
}) {
  return (
    <div className="flight-section">
      <div className="flight-section-header">
        <h3 className="flight-section-title">{title}</h3>
        {description ? <p className="flight-section-description">{description}</p> : null}
      </div>
      {page.items.length === 0 ? (
        <EmptyState {...emptyMessages.flightSearch} headingLevel={4} />
      ) : (
        <ul className="flight-list">
          {page.items.map((flight) => (
            <li key={flight.id}>
              <FlightResultCard flight={flight} passengers={passengers} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FlightResultsLoading() {
  return (
    <div className="card flight-loading" aria-busy="true">
      <Spinner label="Loading flights" />
      <Skeleton lines={4} />
    </div>
  );
}

function FlightResultsError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { message, hint } = toFriendlyError(error);
  return (
    <Alert variant="error" title="Could not load flights" hint={hint} onRetry={onRetry}>
      {message}
    </Alert>
  );
}

/** A calendar date from the URL, shown without a time-zone shift (it is the same date everywhere). */
function formatDate(text: string): string {
  if (!text) return '';
  return formatInZone(`${text}T00:00:00Z`, 'UTC', { dateOnly: true });
}
