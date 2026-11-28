import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { SWRConfig, type Cache } from 'swr';
import { swrDefaults } from '@/api/useApi';
import { ConfirmProvider } from '@/components/ConfirmProvider';

/** Test-only helpers shared by the itinerary screen tests. */
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

export const apiError = (status: number, message: string, details?: Array<{ field: string; message: string }>) =>
  json({ statusCode: status, message, details }, status);

export const page = <T,>(items: T[], extra: Partial<{ page: number; total: number; totalPages: number }> = {}) => ({
  items,
  page: 1,
  limit: 10,
  total: items.length,
  totalPages: items.length ? 1 : 0,
  ...extra,
});

export const countries = page([
  { code: 'AE', name: 'United Arab Emirates', currencyCode: 'AED' },
  { code: 'EG', name: 'Egypt', currencyCode: 'EGP' },
]);

export const egyptTrip = {
  id: 'a1',
  title: 'Two weeks in Egypt',
  countryCodes: ['EG', 'AE'],
  startDate: '2026-12-20',
  dayCount: 5,
  visibility: 'PRIVATE',
  isHidden: false,
  updatedAt: '2026-11-20T10:00:00.000Z',
};

/** Pass the same `cache` twice to model leaving a screen and coming back to it. */
export function mountWithProviders(ui: ReactElement, cache: Cache = new Map()) {
  return render(
    <SWRConfig value={{ ...swrDefaults, provider: () => cache, dedupingInterval: 0 }}>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </SWRConfig>,
  );
}
