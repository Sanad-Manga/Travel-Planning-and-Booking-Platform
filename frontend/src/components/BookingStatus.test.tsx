import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { swrDefaults } from '@/api/useApi';
import { MAX_WAIT_MS } from '@/api/usePollBooking';
import { BookingStatus } from './BookingStatus';

const reply = (body: object, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const booking = (status: string, extra: object = {}) => ({ id: 'b1', status, bookingReference: null, holdExpiresAt: null, ...extra });

function renderStatus(type: 'flight' | 'hotel' = 'flight') {
  return render(
    <SWRConfig value={{ ...swrDefaults, provider: () => new Map(), dedupingInterval: 0 }}>
      <BookingStatus type={type} bookingId="b1" />
    </SWRConfig>,
  );
}

describe('BookingStatus (FLT-23 / HTL-17)', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows a loading state first', () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined));
    renderStatus();
    expect(screen.getByText('Loading your booking')).toBeInTheDocument();
  });

  it('shows the confirmation with the booking reference', async () => {
    fetchMock.mockImplementation(() => reply(booking('CONFIRMED', { bookingReference: 'TRV-4821' })));
    renderStatus();
    expect(await screen.findByText('Your booking is confirmed')).toBeInTheDocument();
    expect(screen.getByText('TRV-4821')).toBeInTheDocument();
  });

  it('says "reservation" for a hotel', async () => {
    fetchMock.mockImplementation(() => reply(booking('CONFIRMED', { bookingReference: 'H-1' })));
    renderStatus('hotel');
    expect(await screen.findByText('Your reservation is confirmed')).toBeInTheDocument();
  });

  it('shows waiting with the countdown while the payment is not confirmed yet', async () => {
    fetchMock.mockImplementation(() => reply(booking('PENDING_PAYMENT', { holdExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString() })));
    renderStatus();
    expect(await screen.findByText('Confirming your payment')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toBeInTheDocument();
    expect(screen.getByText('Awaiting payment')).toBeInTheDocument();
  });

  it('shows the expired message', async () => {
    fetchMock.mockImplementation(() => reply(booking('EXPIRED')));
    renderStatus();
    expect(await screen.findByText('Time to pay ran out')).toBeInTheDocument();
    expect(screen.getByText('Nothing was charged. Start a new booking to try again.')).toBeInTheDocument();
  });

  it('shows the cancelled message', async () => {
    fetchMock.mockImplementation(() => reply(booking('CANCELLED')));
    renderStatus();
    expect(await screen.findByText('This booking was cancelled')).toBeInTheDocument();
  });

  it('shows a load error with a retry that asks again', async () => {
    fetchMock.mockImplementationOnce(() => reply({ statusCode: 404, message: 'Not found' }, 404)).mockImplementation(() => reply(booking('CONFIRMED', { bookingReference: 'TRV-1' })));
    const user = userEvent.setup();
    renderStatus();
    const alert = await screen.findByRole('alert');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Your booking is confirmed')).toBeInTheDocument();
  });

  it('after the maximum wait, says it is taking longer and offers a refresh', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockImplementation(() => reply(booking('PENDING_PAYMENT')));
    renderStatus();
    expect(await screen.findByText('Confirming your payment')).toBeInTheDocument();
    await act(async () => void (await vi.advanceTimersByTimeAsync(MAX_WAIT_MS + 1000)));
    expect(screen.getByText('Still waiting for confirmation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh status' })).toBeInTheDocument();
  });
});
