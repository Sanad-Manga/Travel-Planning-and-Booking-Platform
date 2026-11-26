'use client';

import { useEffect, useState } from 'react';
import { withQuery, type Page } from './types';
import { useApi } from './useApi';

type Filters = Readonly<Record<string, string | number | boolean | null | undefined>>;

/** Pass a query-free endpoint and its filters separately. A null endpoint pauses fetching. */
export function usePaginated<T>(endpoint: string | null, filters: Filters = {}) {
  const query = Object.fromEntries(
    Object.keys(filters)
      .filter((key) => key !== 'page' && key !== 'limit')
      .sort()
      .map((key) => [key, filters[key]]),
  );
  const scope = endpoint === null ? null : withQuery(endpoint, query);
  const [selection, setSelection] = useState({ scope, page: 1, recovering: false });
  // Reset before choosing the SWR key so new filters never fetch the old page number.
  const page = selection.scope === scope ? selection.page : 1;
  const recovering = selection.scope === scope && selection.recovering;
  const key = endpoint === null ? null : withQuery(endpoint, { ...query, page, limit: 10 });
  const request = useApi<Page<T>>(key, recovering ? { revalidateIfStale: false } : undefined);
  const { mutate } = request;

  // A deletion may also invalidate a recently cached destination page. Fetch it once
  // even within SWR's deduping interval before showing its rows or counts again.
  useEffect(() => {
    if (!recovering) return;
    let active = true;
    void mutate().finally(() => {
      if (active) setSelection({ scope, page, recovering: false });
    });
    return () => { active = false; };
  }, [recovering, scope, page, mutate]);

  const data = recovering ? undefined : request.data;
  const lastPage = Math.max(1, data?.totalPages ?? 1);
  if (selection.scope !== scope) {
    setSelection({ scope, page: 1, recovering: false });
  } else if (recovering && !request.data) {
    // An uncached destination already gets the normal SWR fetch.
    setSelection({ scope, page, recovering: false });
  } else if (data && page > lastPage) {
    setSelection({ scope, page: lastPage, recovering: true });
  }

  function setPage(next: number) {
    if (scope !== null && data && Number.isSafeInteger(next) && next >= 1 && next <= lastPage && next !== page) {
      setSelection({ scope, page: next, recovering: false });
    }
  }

  return {
    page, items: data?.items ?? [], data, setPage, revalidate: mutate,
    error: request.error, isLoading: recovering || request.isLoading, isValidating: request.isValidating,
  };
}
