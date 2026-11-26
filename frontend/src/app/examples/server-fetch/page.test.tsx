import { render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { swrDefaults } from '@/api/useApi';

const serverApi = vi.fn();
vi.mock('@/lib/serverApi', () => ({ serverApi: (...args: unknown[]) => serverApi(...args) }));

const { default: ServerFetchExamplePage } = await import('./page');

const me = { id: '1', name: 'Ali Hassan', email: 'ali@example.com', role: 'USER', status: 'ACTIVE', emailVerified: true, preferredCurrency: 'EGP' };

async function renderPage() {
  const ui = await ServerFetchExamplePage();
  return render(<SWRConfig value={{ ...swrDefaults, provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);
}

describe('server-fetch example page (GEN-17)', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    serverApi.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders the user loaded on the server, with no browser request', async () => {
    serverApi.mockResolvedValue({ ok: true, data: me });
    await renderPage();
    expect(screen.getByText('Ali Hassan')).toBeInTheDocument();
    expect(screen.getByText('Loaded on the server.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the browser on a server 401 and loads the user there', async () => {
    serverApi.mockResolvedValue({ ok: false, reason: 'unauthorized' });
    fetchMock.mockResolvedValue(new Response(JSON.stringify(me), { status: 200 }));
    await renderPage();
    expect(await screen.findByText('Ali Hassan')).toBeInTheDocument();
    expect(screen.getByText('Loaded in the browser.')).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/me');
  });
});
