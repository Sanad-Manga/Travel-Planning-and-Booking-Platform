import { allKey, fetchAll } from '@/api/referenceData';
import type { Airport, AllItems } from '@/api/referenceData';
import { useApi } from '@/api/useApi';

/** The IANA time zone of an airport (for "this time is local to ..."), from the list the pickers already loaded. */
export function useAirportZone(iataCode: string): string | undefined {
  const { data } = useApi<AllItems<Airport>>(allKey('/api/airports'), { fetcher: fetchAll });
  return data?.items.find((airport) => airport.iataCode === iataCode)?.timeZone;
}
