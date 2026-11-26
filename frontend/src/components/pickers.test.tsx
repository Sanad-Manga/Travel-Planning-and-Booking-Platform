import { fireEvent, render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { swrDefaults } from '@/api/useApi';
import { AirportPicker, CityPicker, CountryPicker, CurrencyPicker } from './pickers';

const page = (items: unknown[]) => new Response(JSON.stringify({ items, page: 1, limit: 50, total: items.length, totalPages: 1 }), { status: 200 });

const data: Record<string, unknown[]> = {
  '/api/airports': [{ id: '1', iataCode: 'CAI', name: 'Cairo International Airport', city: { cityId: 'cairo', name: 'Cairo' }, country: { code: 'EG', name: 'Egypt' }, timeZone: 'Africa/Cairo' }],
  '/api/countries': [{ code: 'EG', name: 'Egypt', currency: 'EGP' }],
  '/api/cities': [{ cityId: 'cairo', name: 'Cairo', countryCode: 'EG' }],
  '/api/currencies': [{ code: 'EGP' }],
};

function wrap(ui: React.ReactNode) {
  return render(<SWRConfig value={{ ...swrDefaults, provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);
}

describe('reference-data pickers', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) => Promise.resolve(page(data[url.split('?')[0]] ?? [])));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['airport', <AirportPicker key="a" value="" onChange={() => {}} />, 'Airport', /Cairo International Airport/, 'CAI · Cairo, Egypt'],
    ['country', <CountryPicker key="c" value="" onChange={() => {}} />, 'Country', /Egypt/, 'EG'],
    ['city', <CityPicker key="ci" value="" onChange={() => {}} />, 'City', /Cairo/, 'EG'],
    ['currency', <CurrencyPicker key="cu" value="" onChange={() => {}} />, 'Currency', /EGP/, null],
  ])('%s picker loads its list and offers the options', async (_name, ui, label, option, detail) => {
    wrap(ui);
    const input = screen.getByRole('combobox', { name: label });
    fireEvent.focus(input);
    const found = await screen.findByRole('option', { name: option });
    if (detail) expect(found).toHaveTextContent(detail);
  });

  it('the airport picker reports the IATA code', async () => {
    const onChange = vi.fn();
    wrap(<AirportPicker value="" onChange={onChange} />);
    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Cairo/ }));
    expect(onChange).toHaveBeenCalledWith('CAI');
  });

  it('the city picker asks only for the chosen country', async () => {
    wrap(<CityPicker countryCode="EG" value="" onChange={() => {}} />);
    fireEvent.focus(screen.getByRole('combobox'));
    await screen.findByRole('option', { name: /Cairo/ });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/cities?countryCode=EG&page=1&limit=50');
  });

  it('says when the list is longer than what was loaded', async () => {
    fetchMock.mockImplementation((url: string) => {
      const n = Number(new URL(url, 'http://x').searchParams.get('page'));
      const items = Array.from({ length: 50 }, (_, i) => ({ code: `C${n}-${i}` }));
      return Promise.resolve(new Response(JSON.stringify({ items, page: n, limit: 50, total: 1200, totalPages: 24 }), { status: 200 }));
    });
    wrap(<CurrencyPicker value="" onChange={() => {}} />);
    expect(await screen.findByText('Only the first 1,000 of 1,200 are listed.')).toBeInTheDocument();
  });
});
