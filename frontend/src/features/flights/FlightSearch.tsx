'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useTransition } from 'react';
import type { FlightSearchQuery } from '@/api/flights';
import { FlightSearchPanel } from './FlightSearchPanel';
import { buildSearchHref, parseFlightSearchQuery } from './searchParams';

/**
 * FLT-11 / FLT-12 / FLT-15: keeps the search in the address bar. Every change — a new route, a price
 * filter, a sort, another page — replaces the URL, which reloads the results and makes the search
 * shareable and reachable with the browser's Back button.
 *
 * `useSearchParams` needs a Suspense boundary; the flights page provides one.
 */
export function FlightSearch() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const text = searchParams.toString();
  const query = useMemo(() => parseFlightSearchQuery(new URLSearchParams(text)), [text]);
  const [isPending, startTransition] = useTransition();

  function change(next: FlightSearchQuery) {
    startTransition(() => router.replace(buildSearchHref(next), { scroll: false }));
  }

  return (
    <div aria-busy={isPending || undefined}>
      <FlightSearchPanel query={query} onQueryChange={change} />
    </div>
  );
}
