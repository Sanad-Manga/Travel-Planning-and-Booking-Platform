'use client';

import useSWR from 'swr';
import type { SWRConfiguration, SWRResponse } from 'swr';
import { api, ApiError } from '@/lib/api';

/**
 * GEN-02: read data from the backend. The key IS the API path (with its query string), so the cache is
 * shared between components and `mutate(key)` refreshes every user of that data.
 *
 *   const { data, error, isLoading } = useApi<AirportsPage>(airportsKey({ limit: 10 }));
 *
 * Pass `null` as the key to wait (for example until a form value is known). A 4xx answer is not retried:
 * it will not get better by asking again. Show `isLoading` with a Skeleton, `error` with `toFriendlyError`,
 * and an empty `data.items` with an EmptyState.
 */
export const fetcher = (key: string) => api(key);

export const swrDefaults: SWRConfiguration = {
  fetcher,
  revalidateOnFocus: false,
  shouldRetryOnError: (error: unknown) => !(error instanceof ApiError && error.statusCode >= 400 && error.statusCode < 500),
};

export function useApi<T>(key: string | null, config?: SWRConfiguration<T, ApiError>): SWRResponse<T, ApiError> {
  return useSWR<T, ApiError>(key, config as SWRConfiguration<T, ApiError> | undefined);
}
