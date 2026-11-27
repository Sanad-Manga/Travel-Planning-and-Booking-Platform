import { render, screen } from '@testing-library/react';
import useSWR from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRProvider } from './SWRProvider';

let user: { id: string } | null = null;
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => ({ user, loading: false }) }));

const fetcher = vi.fn();
function Probe() {
  const { data } = useSWR('/api/bookings', fetcher);
  return <p>{data ?? 'loading'}</p>;
}

function mount() {
  return render(
    <SWRProvider>
      <Probe />
    </SWRProvider>,
  );
}

beforeEach(() => {
  user = null;
  let n = 0;
  fetcher.mockReset();
  fetcher.mockImplementation(() => Promise.resolve(`data ${++n}`));
});

describe('SWRProvider (ACC-06)', () => {
  it('logging out drops what the signed-in user loaded, so nothing of theirs is shown again', async () => {
    user = { id: 'u1' };
    const { rerender } = mount();
    expect(await screen.findByText('data 1')).toBeInTheDocument();

    user = null;
    rerender(
      <SWRProvider>
        <Probe />
      </SWRProvider>,
    );
    expect(screen.queryByText('data 1')).not.toBeInTheDocument();
    expect(await screen.findByText('data 2')).toBeInTheDocument();
  });

  it('a different user signing in starts with an empty cache too', async () => {
    user = { id: 'u1' };
    const { rerender } = mount();
    await screen.findByText('data 1');
    user = { id: 'u2' };
    rerender(
      <SWRProvider>
        <Probe />
      </SWRProvider>,
    );
    expect(await screen.findByText('data 2')).toBeInTheDocument();
  });

  it('a guest signing in keeps the cache (it only held public data), so nothing reloads', async () => {
    const { rerender } = mount();
    await screen.findByText('data 1');
    user = { id: 'u1' };
    rerender(
      <SWRProvider>
        <Probe />
      </SWRProvider>,
    );
    expect(screen.getByText('data 1')).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
