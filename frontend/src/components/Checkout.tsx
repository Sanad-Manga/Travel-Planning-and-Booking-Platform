'use client';

import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js';
import type { StripeCardElementOptions } from '@stripe/stripe-js';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Schema } from '@/api/types';
import { useApi } from '@/api/useApi';
import { usePollBooking, type BookingType } from '@/api/usePollBooking';
import { api } from '@/lib/api';
import { toFriendlyError } from '@/lib/apiError';
import {
  PaymentStillSettlingError,
  apiBookingType,
  bookingStatusPath,
  classifyPaymentRefusal,
  describeCardFailure,
  retryFailedPayment,
  type PaymentRecord,
} from '@/lib/checkout';
import { formatMoney } from '@/lib/formatMoney';
import { getStripe } from '@/lib/stripe';
import { Alert } from './Alert';
import { Card } from './Card';
import { Countdown } from './Countdown';
import { FormActions } from './FormActions';
import { PageHeader } from './PageHeader';
import { PolicySummary } from './PolicySummary';
import { Skeleton } from './Skeleton';
import { Spinner } from './Spinner';

export interface CheckoutProps {
  type: BookingType;
  bookingId: string;
}

interface Problem {
  message: string;
  hint?: string;
}

/** The card field sits inside Stripe's iframe, which cannot read our CSS, so the theme's own token values are passed in. */
function readCardOptions(): StripeCardElementOptions {
  const css = typeof document === 'undefined' ? null : getComputedStyle(document.documentElement);
  const token = (name: string) => css?.getPropertyValue(name).trim() || undefined;
  return {
    style: {
      base: {
        color: token('--foreground'),
        iconColor: token('--muted'),
        fontFamily: token('--font-sans'),
        fontSize: '16px',
        '::placeholder': { color: token('--muted') },
      },
      invalid: { color: token('--danger-text'), iconColor: token('--danger-text') },
    },
  };
}

/**
 * PAY-01 / PAY-02: one checkout for a flight booking or a hotel reservation. The traveller reads the provider's
 * policies and accepts them, then pays with Stripe's card form. A declined card can be retried until the hold expires;
 * an expired hold shows a clear message. The booking is confirmed by Stripe's webhook, not by this page, so after a
 * successful payment the traveller is sent to the booking's status page.
 */
export function Checkout({ type, bookingId }: CheckoutProps) {
  const stripePromise = getStripe();
  if (!stripePromise) {
    return (
      <Alert variant="error" hint="Ask the team to set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY (a pk_test_ key) for the frontend.">
        Card payments are not set up yet.
      </Alert>
    );
  }
  return (
    <Elements stripe={stripePromise}>
      <CheckoutBody type={type} bookingId={bookingId} />
    </Elements>
  );
}

function CheckoutBody({ type, bookingId }: CheckoutProps) {
  const router = useRouter();
  const stripe = useStripe();
  const elements = useElements();
  const { phase, booking, error: bookingError, refresh } = usePollBooking(type, bookingId);
  const policies = useApi<Schema<'BookingPoliciesResponseDto'>>(`/api/bookings/${apiBookingType(type)}/${encodeURIComponent(bookingId)}/policies`);

  const [accepted, setAccepted] = useState(false);
  const [cardComplete, setCardComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [cardOptions] = useState(readCardOptions);
  const policiesAccepted = useRef(false);
  /** The payment this page started. After a decline it is `failed`, and the next try asks the backend for a new attempt. */
  const attempt = useRef<{ id: string; clientSecret: string; failed: boolean } | null>(null);

  const statusPath = bookingStatusPath(type, bookingId);
  const backPath = type === 'flight' ? '/flights' : '/hotels';

  useEffect(() => {
    if (phase === 'confirmed') router.replace(statusPath);
  }, [phase, router, statusPath]);

  async function pay() {
    if (!stripe || !elements) return;
    const card = elements.getElement(CardElement);
    if (!card) return;
    setBusy(true);
    setProblem(null);
    try {
      if (!policiesAccepted.current) {
        await api(`/api/bookings/${apiBookingType(type)}/${encodeURIComponent(bookingId)}/accept-policies`, { method: 'POST' });
        policiesAccepted.current = true;
      }

      if (!attempt.current) {
        const created = await api<PaymentRecord>('/api/payments', { method: 'POST', body: { bookingType: apiBookingType(type), bookingId } });
        attempt.current = { id: created.id, clientSecret: created.clientSecret ?? '', failed: false };
      } else if (attempt.current.failed) {
        const retried = await retryFailedPayment(attempt.current.id, api);
        if (retried.kind === 'already-paid') {
          router.push(statusPath);
          return;
        }
        attempt.current = { id: retried.payment.id, clientSecret: retried.payment.clientSecret ?? '', failed: false };
      }

      const result = await stripe.confirmCardPayment(attempt.current.clientSecret, { payment_method: { card } });
      if (result.error) {
        // A decline leaves this attempt failed (the backend records it); a typo in the card leaves it usable as it is.
        if (result.error.type === 'card_error') attempt.current.failed = true;
        setProblem(describeCardFailure(result.error));
        return;
      }
      router.push(statusPath);
    } catch (error) {
      if (error instanceof PaymentStillSettlingError) {
        setProblem({ message: 'Your bank is still settling the previous attempt.', hint: 'Wait a few seconds and press Pay again. You have not been charged twice.' });
        return;
      }
      const kind = classifyPaymentRefusal(error);
      if (kind === 'hold-expired') {
        // Ask the backend again: the page then switches to the "time ran out" screen. The message covers the moment before that.
        setProblem({ message: 'The time to pay this booking has run out.', hint: 'Nothing was charged.' });
        refresh();
        return;
      }
      if (kind === 'payment-in-progress') {
        setProblem({
          message: 'A payment for this booking is already in progress.',
          hint: 'If you just paid, check your booking status. If you closed this page before paying, the booking is released when its time runs out and you can book again.',
        });
        return;
      }
      const friendly = toFriendlyError(error);
      setProblem({ message: friendly.message, hint: friendly.hint });
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void pay();
  }

  if (phase === 'loading' || phase === 'confirmed') {
    return (
      <div aria-busy="true">
        <Spinner label={phase === 'confirmed' ? 'Taking you to your booking' : 'Loading checkout'} />
        <Skeleton lines={4} />
      </div>
    );
  }

  if (phase === 'error' || !booking) {
    const friendly = toFriendlyError(bookingError);
    return (
      <Alert variant="error" hint={friendly.hint} onRetry={refresh}>
        {friendly.message}
      </Alert>
    );
  }

  if (phase === 'expired') {
    return (
      <>
        <Alert variant="warning" title="Time to pay ran out" hint="Nothing was charged. The hold on this booking was released.">
          <p>Start again to get a new hold.</p>
        </Alert>
        <p>
          <Link className="btn btn-primary" href={backPath}>
            {type === 'flight' ? 'Search flights again' : 'Search hotels again'}
          </Link>
        </p>
      </>
    );
  }

  if (phase === 'cancelled') {
    return (
      <Alert variant="warning" title="This booking was cancelled">
        <p>It can no longer be paid.</p>
      </Alert>
    );
  }

  const amount = formatMoney(booking.totalCents, booking.currency);
  const testMode = (process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '').startsWith('pk_test_');

  return (
    <>
      <PageHeader
        title="Checkout"
        description={type === 'flight' ? 'Read the policies, then pay to confirm your flight.' : 'Read the policies, then pay to confirm your stay.'}
      />

      <Card title="Amount due">
        <p>
          Total: <strong>{amount}</strong>
        </p>
        {booking.holdExpiresAt ? (
          <p>
            <Countdown expiresAt={booking.holdExpiresAt} onExpire={refresh} />
          </p>
        ) : null}
      </Card>

      {policies.isLoading ? <Skeleton lines={4} /> : null}
      {policies.error ? (
        <Alert variant="error" hint={toFriendlyError(policies.error).hint} onRetry={() => void policies.mutate()}>
          {toFriendlyError(policies.error).message}
        </Alert>
      ) : null}
      {policies.data ? <PolicySummary type={type} policies={policies.data} /> : null}

      <form onSubmit={onSubmit} noValidate>
        <div className="field">
          <label className="field-label">
            <input type="checkbox" checked={accepted} disabled={busy || !policies.data} onChange={(event) => setAccepted(event.target.checked)} /> I have read and accept
            these policies
          </label>
        </div>

        <div className="field">
          <span className="field-label" id="card-details-label">
            Card details
          </span>
          <div className="field-input" role="group" aria-labelledby="card-details-label">
            <CardElement options={cardOptions} onChange={(event) => setCardComplete(event.complete)} />
          </div>
          {testMode ? <p className="field-hint">Test mode: use card 4242 4242 4242 4242, any future date and any 3-digit code.</p> : null}
          <p className="field-hint">Your card details go straight to Stripe. They never reach this site or our servers.</p>
        </div>

        {problem ? (
          <Alert variant="error" hint={problem.hint}>
            {problem.message}
          </Alert>
        ) : null}

        <FormActions
          primaryLabel={`Pay ${amount}`}
          submitting={busy}
          submittingLabel="Processing payment…"
          disabled={!accepted || !cardComplete || !stripe || !policies.data}
          cancelHref={backPath}
          cancelLabel="Back"
        />
      </form>
    </>
  );
}
