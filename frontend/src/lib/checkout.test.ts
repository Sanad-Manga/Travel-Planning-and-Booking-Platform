import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import {
  PaymentStillSettlingError,
  apiBookingType,
  bookingStatusPath,
  classifyPaymentRefusal,
  describeCardFailure,
  retryFailedPayment,
  usablePublishableKey,
} from './checkout';

describe('small helpers (PAY-01 / PAY-02)', () => {
  it('builds the status page path for each booking type', () => {
    expect(bookingStatusPath('flight', 'abc')).toBe('/bookings/flights/abc');
    expect(bookingStatusPath('hotel', 'a b')).toBe('/bookings/hotels/a%20b');
  });

  it('uses the upper-case type the backend expects', () => {
    expect(apiBookingType('flight')).toBe('FLIGHT');
    expect(apiBookingType('hotel')).toBe('HOTEL');
  });

  it('accepts only a publishable key, never a secret key', () => {
    expect(usablePublishableKey(' pk_test_abc ')).toBe('pk_test_abc');
    expect(usablePublishableKey('pk_live_abc')).toBe('pk_live_abc');
    expect(usablePublishableKey('sk_test_abc')).toBeNull();
    expect(usablePublishableKey('rk_live_abc')).toBeNull();
    expect(usablePublishableKey('')).toBeNull();
    expect(usablePublishableKey(undefined)).toBeNull();
  });
});

describe('describeCardFailure', () => {
  it("shows Stripe's own words for a declined card", () => {
    expect(describeCardFailure({ type: 'card_error', code: 'card_declined', message: 'Your card was declined.' }).message).toBe('Your card was declined.');
  });

  it('shows the words for a card typo', () => {
    expect(describeCardFailure({ type: 'validation_error', message: 'Your card number is incomplete.' }).message).toBe('Your card number is incomplete.');
  });

  it('does not show an internal or network message', () => {
    const result = describeCardFailure({ type: 'api_connection_error', message: 'Failed to fetch https://api.stripe.com/v1/secret-detail' });
    expect(result.message).toBe('The payment could not be completed.');
    expect(JSON.stringify(result)).not.toContain('stripe.com');
  });
});

describe('retryFailedPayment', () => {
  const payment = (status: string, extra: object = {}) => ({ id: 'p1', status, ...extra });

  it('retries at once when the failed attempt is already recorded as FAILED', async () => {
    const call = vi.fn().mockResolvedValueOnce(payment('FAILED')).mockResolvedValueOnce(payment('REQUIRES_PAYMENT', { id: 'p2', clientSecret: 'secret_2' }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await retryFailedPayment('p1', call, sleep);
    expect(result).toEqual({ kind: 'new-payment', payment: payment('REQUIRES_PAYMENT', { id: 'p2', clientSecret: 'secret_2' }) });
    expect(call.mock.calls[0][0]).toBe('/api/payments/p1');
    expect(call.mock.calls[1]).toEqual(['/api/payments/p1/retry', { method: 'POST' }]);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('waits while the webhook is late, then retries', async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(payment('REQUIRES_PAYMENT'))
      .mockResolvedValueOnce(payment('REQUIRES_PAYMENT'))
      .mockResolvedValueOnce(payment('CANCELLED'))
      .mockResolvedValueOnce(payment('REQUIRES_PAYMENT', { id: 'p2', clientSecret: 's' }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await retryFailedPayment('p1', call, sleep);
    expect(result.kind).toBe('new-payment');
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not charge twice: an attempt that went through is reported, not retried', async () => {
    for (const status of ['SUCCEEDED', 'PROCESSING']) {
      const call = vi.fn().mockResolvedValue(payment(status));
      expect(await retryFailedPayment('p1', call, vi.fn())).toEqual({ kind: 'already-paid' });
      expect(call).toHaveBeenCalledTimes(1);
    }
  });

  it('gives up after the tries when the attempt never settles, without retrying', async () => {
    const call = vi.fn().mockResolvedValue(payment('REQUIRES_PAYMENT'));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(retryFailedPayment('p1', call, sleep, 3)).rejects.toBeInstanceOf(PaymentStillSettlingError);
    expect(call).toHaveBeenCalledTimes(3);
    expect(call.mock.calls.every(([path]) => !String(path).endsWith('/retry'))).toBe(true);
  });
});

describe('classifyPaymentRefusal', () => {
  const conflict = (message: string) => new ApiError(409, message);
  it('tells an expired hold from a payment already in progress', () => {
    expect(classifyPaymentRefusal(conflict('This booking is not awaiting payment, or its hold has expired'))).toBe('hold-expired');
    expect(classifyPaymentRefusal(conflict('A payment is already in progress for this booking'))).toBe('payment-in-progress');
    expect(classifyPaymentRefusal(conflict('Something else'))).toBe('other');
  });

  it('treats anything that is not a 409 as other', () => {
    expect(classifyPaymentRefusal(new ApiError(404, 'expired'))).toBe('other');
    expect(classifyPaymentRefusal(new Error('expired'))).toBe('other');
  });
});
