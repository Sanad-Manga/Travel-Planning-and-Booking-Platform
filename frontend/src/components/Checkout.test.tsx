import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { swrDefaults } from '@/api/useApi';

const router = { push: vi.fn(), replace: vi.fn() };
const stripe = { confirmCardPayment: vi.fn(), retrievePaymentIntent: vi.fn() };
const getStripe = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/stripe', () => ({ getStripe: () => getStripe() }));
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  CardElement: ({ onChange }: { onChange: (event: { complete: boolean }) => void }) => (
    <button type="button" onClick={() => onChange({ complete: true })}>
      fill card
    </button>
  ),
  useStripe: () => stripe,
  useElements: () => ({ getElement: () => ({ card: true }) }),
}));

import { Checkout } from './Checkout';

const reply = (body: object, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const failure = (statusCode: number, message: string) => reply({ statusCode, message }, statusCode);

interface World {
  status: string;
  holdMs: number;
  holdAt?: number;
  bookingConflict: boolean;
  payments: Record<string, { status: string }>;
  createReply: () => Promise<Response>;
}
let world: World;
const calls: Array<{ method: string; path: string; body?: unknown }> = [];

const policies = {
  bookingType: 'FLIGHT',
  bookingId: 'b1',
  cancellationTiers: [{ daysBeforeThreshold: 7, refundPercent: 50 }],
  baggagePolicy: null,
};

function fakeBackend(input: string, init: RequestInit = {}) {
  const method = init.method ?? 'GET';
  calls.push({ method, path: input, body: init.body ? JSON.parse(String(init.body)) : undefined });
  if (/\/api\/(flight|hotel)-bookings\/b1$/.test(input)) {
    if (world.bookingConflict) return failure(409, 'A booking is available only while it is pending payment or after it is confirmed');
    return reply({
      id: 'b1',
      status: world.status,
      totalCents: 125050,
      currency: 'USD',
      bookingReference: null,
      holdExpiresAt: new Date((world.holdAt ??= Date.now() + world.holdMs)).toISOString(),
    });
  }
  if (input.endsWith('/policies')) return reply(policies);
  if (input.endsWith('/accept-policies')) return reply({ acceptedAt: new Date().toISOString() }, 201);
  if (input === '/api/payments' && method === 'POST') return world.createReply();
  const retry = input.match(/^\/api\/payments\/(\w+)\/retry$/);
  if (retry) return reply({ id: 'p2', status: 'REQUIRES_PAYMENT', clientSecret: 'secret_p2' }, 201);
  const one = input.match(/^\/api\/payments\/(\w+)$/);
  if (one) return reply({ id: one[1], ...world.payments[one[1]] });
  return failure(404, 'unexpected ' + input);
}

function renderCheckout(type: 'flight' | 'hotel' = 'flight') {
  return render(
    <SWRConfig value={{ ...swrDefaults, provider: () => new Map(), dedupingInterval: 0 }}>
      <Checkout type={type} bookingId="b1" />
    </SWRConfig>,
  );
}

const created = () => reply({ id: 'p1', status: 'REQUIRES_PAYMENT', clientSecret: 'secret_p1' }, 201);
const payButton = () => screen.getByRole('button', { name: /^Pay / });
const paymentPosts = () => calls.filter((call) => call.method === 'POST' && call.path === '/api/payments');
const posts = () => calls.filter((call) => call.method === 'POST').map((call) => call.path);

async function readyToPay(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText(/Cancelling 7 days or more before/);
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'fill card' }));
}

describe('Checkout (PAY-01 / PAY-02)', () => {
  beforeEach(() => {
    calls.length = 0;
    router.push.mockReset();
    router.replace.mockReset();
    stripe.confirmCardPayment.mockReset();
    stripe.retrievePaymentIntent.mockReset().mockResolvedValue({ paymentIntent: { status: 'requires_payment_method' } });
    getStripe.mockReset().mockReturnValue(Promise.resolve({}));
    world = { status: 'PENDING_PAYMENT', holdMs: 8 * 60_000, bookingConflict: false, payments: { p1: { status: 'FAILED' } }, createReply: created };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string, init?: RequestInit) => fakeBackend(input, init)),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('shows the total, the countdown and the policies, and keeps Pay disabled until the policies are accepted and a card is entered', async () => {
    const user = userEvent.setup();
    renderCheckout();
    expect((await screen.findAllByText('$1,250.50')).length).toBeGreaterThan(0);
    expect(screen.getByRole('timer')).toBeInTheDocument();
    expect(await screen.findByText('Cancelling 7 days or more before departure: 50% refund')).toBeInTheDocument();
    expect(payButton()).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'fill card' }));
    expect(payButton()).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    expect(payButton()).toBeEnabled();
    await user.click(screen.getByRole('checkbox'));
    expect(payButton()).toBeDisabled();
  });

  it('accepts the policies, creates the payment, confirms the card with Stripe and goes to the status page', async () => {
    stripe.confirmCardPayment.mockResolvedValue({ paymentIntent: { status: 'succeeded' } });
    const user = userEvent.setup();
    renderCheckout();
    await readyToPay(user);
    await user.click(payButton());
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/bookings/flights/b1'));
    expect(posts()).toEqual(['/api/bookings/FLIGHT/b1/accept-policies', '/api/payments']);
    expect(paymentPosts()[0].body).toEqual({ bookingType: 'FLIGHT', bookingId: 'b1' });
    expect(stripe.confirmCardPayment).toHaveBeenCalledWith('secret_p1', { payment_method: { card: { card: true } } });
  });

  it('uses the hotel endpoints and status page for a hotel', async () => {
    stripe.confirmCardPayment.mockResolvedValue({ paymentIntent: { status: 'succeeded' } });
    const user = userEvent.setup();
    renderCheckout('hotel');
    await readyToPay(user);
    await user.click(payButton());
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/bookings/hotels/b1'));
    expect(posts()[0]).toBe('/api/bookings/HOTEL/b1/accept-policies');
    expect(paymentPosts()[0].body).toEqual({ bookingType: 'HOTEL', bookingId: 'b1' });
  });

  it('shows a declined card and lets the traveller retry with a new payment, accepting the policies only once', async () => {
    stripe.confirmCardPayment
      .mockResolvedValueOnce({ error: { type: 'card_error', code: 'card_declined', message: 'Your card was declined.' } })
      .mockResolvedValueOnce({ paymentIntent: { status: 'succeeded' } });
    const user = userEvent.setup();
    renderCheckout();
    await readyToPay(user);
    await user.click(payButton());
    expect(await screen.findByText('Your card was declined.')).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();

    await user.click(payButton());
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/bookings/flights/b1'));
    expect(stripe.confirmCardPayment).toHaveBeenNthCalledWith(2, 'secret_p2', expect.anything());
    expect(posts()).toEqual(['/api/bookings/FLIGHT/b1/accept-policies', '/api/payments', '/api/payments/p1/retry']);
    expect(screen.queryByText('Your card was declined.')).not.toBeInTheDocument();
  });

  it('does not charge again when the "failed" attempt turns out to have gone through', async () => {
    world.payments.p1 = { status: 'SUCCEEDED' };
    stripe.confirmCardPayment.mockResolvedValueOnce({ error: { type: 'card_error', message: 'Your card was declined.' } });
    const user = userEvent.setup();
    renderCheckout();
    await readyToPay(user);
    await user.click(payButton());
    await screen.findByText('Your card was declined.');
    await user.click(payButton());
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/bookings/flights/b1'));
    expect(stripe.confirmCardPayment).toHaveBeenCalledTimes(1);
    expect(calls.some((call) => call.path.endsWith('/retry'))).toBe(false);
  });

  it('after a card typo, tries the same payment again without a new one', async () => {
    stripe.confirmCardPayment
      .mockResolvedValueOnce({ error: { type: 'validation_error', message: 'Your card number is incomplete.' } })
      .mockResolvedValueOnce({ paymentIntent: { status: 'succeeded' } });
    const user = userEvent.setup();
    renderCheckout();
    await readyToPay(user);
    await user.click(payButton());
    expect(await screen.findByText('Your card number is incomplete.')).toBeInTheDocument();
    await user.click(payButton());
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(paymentPosts()).toHaveLength(1);
    expect(calls.some((call) => call.path.endsWith('/retry'))).toBe(false);
    expect(stripe.confirmCardPayment).toHaveBeenNthCalledWith(2, 'secret_p1', expect.anything());
  });

  it('shows the time-ran-out screen when the hold expires while paying', async () => {
    world.createReply = () => failure(409, 'This booking is not awaiting payment, or its hold has expired');
    const user = userEvent.setup();
    renderCheckout();
    await readyToPay(user);
    world.status = 'EXPIRED';
    await user.click(payButton());
    expect(await screen.findByText('Time to pay ran out')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Pay / })).not.toBeInTheDocument();
    expect(stripe.confirmCardPayment).not.toHaveBeenCalled();
  });

  it('shows the expired message straight away for an expired booking, with a way back', async () => {
    world.status = 'EXPIRED';
    renderCheckout();
    expect(await screen.findByText('Time to pay ran out')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Search flights again' })).toHaveAttribute('href', '/flights');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('explains a payment that is already in progress', async () => {
    world.createReply = () => failure(409, 'A payment is already in progress for this booking');
    const user = userEvent.setup();
    renderCheckout();
    await readyToPay(user);
    await user.click(payButton());
    expect(await screen.findByText('A payment for this booking is already in progress.')).toBeInTheDocument();
    expect(stripe.confirmCardPayment).not.toHaveBeenCalled();
  });

  it('sends a booking that is already confirmed to its status page', async () => {
    world.status = 'CONFIRMED';
    renderCheckout();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/bookings/flights/b1'));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('blocks payment and says why when the policies cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string, init?: RequestInit) => (input.endsWith('/policies') ? failure(500, 'boom') : fakeBackend(input, init))),
    );
    renderCheckout();
    const alert = await screen.findByRole('alert', {}, { timeout: 8000 });
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(payButton()).toBeDisabled();
  }, 15000);

  it('does not confirm a card on an earlier payment once the hold has run out (no charge-then-refund)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    world.holdMs = 60_000;
    stripe.confirmCardPayment.mockResolvedValueOnce({ error: { type: 'validation_error', message: 'Your card number is incomplete.' } });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCheckout();
    await readyToPay(user);
    await user.click(payButton());
    expect(await screen.findByText('Your card number is incomplete.')).toBeInTheDocument();
    await act(async () => void (await vi.advanceTimersByTimeAsync(61_000)));
    expect(payButton()).toBeDisabled();
    expect(stripe.confirmCardPayment).toHaveBeenCalledTimes(1);
  });

  it('refuses to confirm when Pay is pressed after the hold time on this device has passed, before the countdown ticks', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    world.holdMs = 60_000;
    stripe.confirmCardPayment.mockResolvedValueOnce({ error: { type: 'validation_error', message: 'Your card number is incomplete.' } });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCheckout();
    await readyToPay(user);
    await user.click(payButton());
    await screen.findByText('Your card number is incomplete.');
    vi.setSystemTime(Date.now() + 120_000);
    await user.click(payButton());
    expect(await screen.findByText('The time to pay this booking has run out.')).toBeInTheDocument();
    expect(stripe.confirmCardPayment).toHaveBeenCalledTimes(1);
  });

  it('checks Stripe when the failure is not a card problem, and goes to the status page if the payment went through', async () => {
    stripe.confirmCardPayment.mockResolvedValueOnce({ error: { type: 'api_connection_error', message: 'Failed to fetch' } });
    stripe.retrievePaymentIntent.mockResolvedValueOnce({ paymentIntent: { status: 'succeeded' } });
    const user = userEvent.setup();
    renderCheckout();
    await readyToPay(user);
    await user.click(payButton());
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/bookings/flights/b1'));
    expect(stripe.retrievePaymentIntent).toHaveBeenCalledWith('secret_p1');
  });

  it('shows a general message, without claiming nothing was charged, when a non-card failure did not go through', async () => {
    stripe.confirmCardPayment.mockResolvedValueOnce({ error: { type: 'api_connection_error', message: 'Failed to fetch' } });
    const user = userEvent.setup();
    renderCheckout();
    await readyToPay(user);
    await user.click(payButton());
    expect(await screen.findByText('The payment could not be completed.')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing was charged/)).not.toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('shows the time-ran-out screen when the flight endpoint starts answering 409 for the booking', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCheckout();
    await readyToPay(user);
    world.bookingConflict = true;
    await act(async () => void (await vi.advanceTimersByTimeAsync(3000)));
    expect(await screen.findByText('Time to pay ran out')).toBeInTheDocument();
  });

  it('says the booking is no longer open when the very first load is a 409', async () => {
    world.bookingConflict = true;
    renderCheckout();
    expect(await screen.findByText('This booking is no longer open')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('says the bank is still settling when the failed attempt never becomes retryable, and stays usable', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    world.payments.p1 = { status: 'REQUIRES_PAYMENT' };
    stripe.confirmCardPayment.mockResolvedValueOnce({ error: { type: 'card_error', message: 'Your card was declined.' } });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCheckout();
    await readyToPay(user);
    await user.click(payButton());
    await screen.findByText('Your card was declined.');
    await user.click(payButton());
    await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));
    expect(await screen.findByText('Your bank is still settling the previous attempt.')).toBeInTheDocument();
    expect(stripe.confirmCardPayment).toHaveBeenCalledTimes(1);
    expect(payButton()).toBeEnabled();
  });

  it('tells the traveller what is missing while Pay is disabled, and shows the test-card hint only for a test key', async () => {
    vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_test_demo');
    renderCheckout();
    expect(await screen.findByText('To pay: accept the policies and enter your card details.')).toBeInTheDocument();
    expect(screen.getByText(/Test mode: use card 4242 4242 4242 4242/)).toBeInTheDocument();
  });

  it('shows no test-card hint without a test key', async () => {
    vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_live_demo');
    renderCheckout();
    await screen.findByText('To pay: accept the policies and enter your card details.');
    expect(screen.queryByText(/Test mode/)).not.toBeInTheDocument();
  });

  it('explains when no Stripe key is set, and shows no form', () => {
    getStripe.mockReturnValue(null);
    renderCheckout();
    expect(screen.getByText('Card payments are not set up yet.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('shows an error with a retry when the booking cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => failure(404, 'Booking not found')),
    );
    renderCheckout();
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    await act(async () => undefined);
  });
});
