import { act, render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { swrDefaults } from './useApi';
import { FAST_POLL_MS, MAX_WAIT_MS, SLOW_POLL_MS, isFinalStatus, phaseOf, pollIntervalMs, usePollBooking } from './usePollBooking';

const booking = (status: string, extra: object = {}) => ({ id: 'b1', status, bookingReference: null, holdExpiresAt: null, ...extra });
const reply = (body: object, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

function Probe({ type = 'flight', id = 'b1' }: { type?: 'flight' | 'hotel'; id?: string | null }) {
  const { phase, refresh } = usePollBooking(type, id);
  return (
    <>
      <p>phase:{phase}</p>
      <button type="button" onClick={refresh}>
        refresh
      </button>
    </>
  );
}

function renderProbe(props: React.ComponentProps<typeof Probe> = {}) {
  return render(
    <SWRConfig value={{ ...swrDefaults, provider: () => new Map(), dedupingInterval: 0 }}>
      <Probe {...props} />
    </SWRConfig>,
  );
}

describe('pure helpers', () => {
  it('polls fast first, then slower', () => {
    expect(pollIntervalMs(0)).toBe(FAST_POLL_MS);
    expect(pollIntervalMs(29_999)).toBe(FAST_POLL_MS);
    expect(pollIntervalMs(30_000)).toBe(SLOW_POLL_MS);
  });

  it('treats every status except PENDING_PAYMENT as final', () => {
    expect(isFinalStatus('PENDING_PAYMENT')).toBe(false);
    expect(isFinalStatus(undefined)).toBe(false);
    for (const status of ['CONFIRMED', 'COMPLETED', 'EXPIRED', 'CANCELLED'] as const) expect(isFinalStatus(status)).toBe(true);
  });

  it('maps a status to a phase; a final status wins over a timeout', () => {
    const phase = (status: string, timedOut = false) => phaseOf(booking(status) as never, undefined, timedOut);
    expect(phase('PENDING_PAYMENT')).toBe('pending');
    expect(phase('PENDING_PAYMENT', true)).toBe('timeout');
    expect(phase('CONFIRMED', true)).toBe('confirmed');
    expect(phase('COMPLETED')).toBe('confirmed');
    expect(phase('EXPIRED')).toBe('expired');
    expect(phase('CANCELLED')).toBe('cancelled');
    expect(phaseOf(undefined, undefined, false)).toBe('loading');
    expect(phaseOf(undefined, new Error('x'), false)).toBe('error');
    expect(phaseOf(undefined, new ApiError(404, 'nope'), false)).toBe('error');
  });

  it('reads a 409 (the flight endpoint refuses a booking that is no longer pending or confirmed) as expired when it was seen pending, else unavailable', () => {
    const closed = new ApiError(409, 'A booking is available only while it is pending payment or after it is confirmed');
    expect(phaseOf(booking('PENDING_PAYMENT') as never, closed, false)).toBe('expired');
    expect(phaseOf(undefined, closed, false)).toBe('unavailable');
  });
});

describe('usePollBooking (FLT-23 / HTL-17)', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

  it('asks the right endpoint for each booking type', async () => {
    fetchMock.mockImplementation(() => reply(booking('CONFIRMED')));
    renderProbe({ type: 'hotel', id: 'h 1' });
    expect(await screen.findByText('phase:confirmed')).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/hotel-bookings/h%201');
  });

  it('does not ask while there is no id', async () => {
    renderProbe({ id: null });
    await tick(5000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('phase:loading')).toBeInTheDocument();
  });

  it('keeps asking while pending, then stops once the booking is confirmed', async () => {
    let calls = 0;
    fetchMock.mockImplementation(() => reply(booking(++calls < 3 ? 'PENDING_PAYMENT' : 'CONFIRMED', { bookingReference: 'TRV-1' })));
    renderProbe();
    expect(await screen.findByText('phase:pending')).toBeInTheDocument();
    await tick(FAST_POLL_MS);
    await tick(FAST_POLL_MS);
    expect(await screen.findByText('phase:confirmed')).toBeInTheDocument();
    const callsAtConfirm = fetchMock.mock.calls.length;
    await tick(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(callsAtConfirm);
  });

  it('stops on an expired booking', async () => {
    fetchMock.mockImplementation(() => reply(booking('EXPIRED')));
    renderProbe();
    expect(await screen.findByText('phase:expired')).toBeInTheDocument();
    await tick(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('times out after the maximum wait, stops asking, and polls again after a refresh', async () => {
    fetchMock.mockImplementation(() => reply(booking('PENDING_PAYMENT')));
    renderProbe();
    expect(await screen.findByText('phase:pending')).toBeInTheDocument();
    await tick(MAX_WAIT_MS + 1000);
    expect(screen.getByText('phase:timeout')).toBeInTheDocument();
    const callsAtTimeout = fetchMock.mock.calls.length;
    await tick(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(callsAtTimeout);

    await act(async () => screen.getByRole('button', { name: 'refresh' }).click());
    expect(screen.getByText('phase:pending')).toBeInTheDocument();
    await tick(100);
    const callsAfterRefresh = fetchMock.mock.calls.length;
    expect(callsAfterRefresh).toBeGreaterThan(callsAtTimeout);
    await tick(FAST_POLL_MS * 2);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterRefresh);
  });

  it('turns pending into expired when the backend starts answering 409, and stops asking', async () => {
    let calls = 0;
    fetchMock.mockImplementation(() =>
      ++calls === 1 ? reply(booking('PENDING_PAYMENT')) : reply({ statusCode: 409, message: 'A booking is available only while it is pending payment or after it is confirmed' }, 409),
    );
    renderProbe();
    expect(await screen.findByText('phase:pending')).toBeInTheDocument();
    await tick(FAST_POLL_MS);
    expect(await screen.findByText('phase:expired')).toBeInTheDocument();
    const callsAtExpiry = fetchMock.mock.calls.length;
    await tick(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(callsAtExpiry);
  });

  it('says unavailable when the very first answer is a 409', async () => {
    fetchMock.mockImplementation(() => reply({ statusCode: 409, message: 'A booking is available only while it is pending payment or after it is confirmed' }, 409));
    renderProbe();
    expect(await screen.findByText('phase:unavailable')).toBeInTheDocument();
  });

  it('reports a 404 as an error and does not retry it', async () => {
    fetchMock.mockImplementation(() => reply({ statusCode: 404, message: 'Not found' }, 404));
    renderProbe();
    expect(await screen.findByText('phase:error')).toBeInTheDocument();
    await tick(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps showing the last booking when a later poll fails', async () => {
    let calls = 0;
    fetchMock.mockImplementation(() => (++calls === 1 ? reply(booking('PENDING_PAYMENT')) : reply({ statusCode: 500, message: 'boom' }, 500)));
    renderProbe();
    expect(await screen.findByText('phase:pending')).toBeInTheDocument();
    await tick(FAST_POLL_MS * 3);
    expect(screen.getByText('phase:pending')).toBeInTheDocument();
  });
});
