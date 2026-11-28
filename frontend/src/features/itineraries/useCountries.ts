'use client';

import { allKey, fetchAll, type AllItems, type Country } from '@/api/referenceData';
import { useApi } from '@/api/useApi';

/** The country list (shared SWR cache with the pickers) and a code-to-name lookup that falls back to the code. */
export function useCountries() {
  const { data, error, isLoading } = useApi<AllItems<Country>>(allKey('/api/countries'), { fetcher: fetchAll });
  const countries = data?.items ?? [];
  const names = new Map(countries.map((country) => [country.code, country.name]));
  return { countries, error, isLoading, nameOf: (code: string) => names.get(code) ?? code };
}
