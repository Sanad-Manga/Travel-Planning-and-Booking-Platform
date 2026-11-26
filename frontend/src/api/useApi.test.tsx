import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';
import { ApiError } from '@/lib/api';
import { swrDefaults, useApi } from './useApi';

function Probe({ path }: { path: string | null }) {
  const { data, error, isLoading } = useApi<{ name: string }>(path);
  if (isLoading) return <p>loading</p>;
  if (error) return <p>error {error.statusCode}</p>;
  return <p>{data ? `hello ${data.name}` : 'idle'}</p>;
}

function renderProbe(path: string | null) {
  return render(
    <SWRConfig value={{ ...swrDefaults, provider: () => new Map(), dedupingInterval: 0, errorRetryInterval: 5 }}>
      <Probe path={path} />
    </SWRConfig>,
  );
}

describe('useApi', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows loading, then the data', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ name: 'Cairo' }), { status: 200 }));
    renderProbe('/api/things/1');
    expect(screen.getByText('loading')).toBeInTheDocument();
    expect(await screen.findByText('hello Cairo')).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/things/1');
  });

  it('does not fetch while the key is null', () => {
    renderProbe(null);
    expect(screen.getByText('idle')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not retry a 4xx answer', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ statusCode: 404, message: 'Not found' }), { status: 404 })));
    renderProbe('/api/things/9');
    expect(await screen.findByText('error 404')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 60));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx answer', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ statusCode: 503, message: 'down' }), { status: 503 }))
      .mockResolvedValue(new Response(JSON.stringify({ name: 'Back' }), { status: 200 }));
    renderProbe('/api/things/2');
    await waitFor(() => expect(screen.getByText('hello Back')).toBeInTheDocument(), { timeout: 3000 });
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('retry rule: only server errors and network failures are retried', () => {
    const rule = swrDefaults.shouldRetryOnError as (e: unknown) => boolean;
    expect(rule(new ApiError(404, 'x'))).toBe(false);
    expect(rule(new ApiError(429, 'x'))).toBe(false);
    expect(rule(new ApiError(503, 'x'))).toBe(true);
    expect(rule(new TypeError('Failed to fetch'))).toBe(true);
  });
});
