'use client';

import { allKey, fetchAll } from '@/api/referenceData';
import type { Airport, City, Country, Currency } from '@/api/referenceData';
import { useApi } from '@/api/useApi';
import { toFriendlyError } from '@/lib/apiError';
import { ReferencePicker } from './ReferencePicker';
import type { PickerOption, ReferencePickerProps } from './ReferencePicker';

/** What every picker accepts: the ReferencePicker props minus the list it loads itself. The label has a default. */
export type PickerProps = Omit<ReferencePickerProps, 'options' | 'isLoading' | 'loadError' | 'label'> & { label?: string };

/** Loads a whole reference list once (SWR-cached and shared by every picker on the page) and maps it to options. */
function useOptions<T>(key: string, toOption: (item: T) => PickerOption) {
  const { data, error, isLoading } = useApi<T[]>(key, { fetcher: fetchAll });
  return {
    options: (data ?? []).map(toOption),
    isLoading,
    loadError: error ? `Could not load the list. ${toFriendlyError(error).hint}` : undefined,
  };
}

/** FLT-02: choose an airport; the value is its IATA code (what flight search and flights use). */
export function AirportPicker({ label = 'Airport', ...props }: PickerProps) {
  const list = useOptions<Airport>(allKey('/api/airports'), (a) => ({
    value: a.iataCode,
    label: a.name,
    detail: `${a.iataCode} · ${a.city.name}, ${a.country.name}`,
  }));
  return <ReferencePicker label={label} {...list} {...props} />;
}

/** GEN-12: choose a country; the value is its official two-letter code. */
export function CountryPicker({ label = 'Country', ...props }: PickerProps) {
  const list = useOptions<Country>(allKey('/api/countries'), (c) => ({ value: c.code, label: c.name, detail: c.code }));
  return <ReferencePicker label={label} {...list} {...props} />;
}

/** GEN-12: choose a city, optionally only of one country; the value is the official city id. */
export function CityPicker({ label = 'City', countryCode, ...props }: PickerProps & { countryCode?: string }) {
  const list = useOptions<City>(allKey('/api/cities', { countryCode }), (c) => ({
    value: c.cityId,
    label: c.name,
    detail: c.countryCode,
  }));
  return <ReferencePicker label={label} {...list} {...props} />;
}

/** GEN-12: choose a currency; the value is its official code. */
export function CurrencyPicker({ label = 'Currency', ...props }: PickerProps) {
  const list = useOptions<Currency>(allKey('/api/currencies'), (c) => ({ value: c.code, label: c.code }));
  return <ReferencePicker label={label} {...list} {...props} />;
}
