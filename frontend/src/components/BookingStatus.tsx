'use client';

import { usePollBooking, type BookingType } from '@/api/usePollBooking';
import { toFriendlyError } from '@/lib/apiError';
import { Alert } from './Alert';
import { Countdown } from './Countdown';
import { Skeleton } from './Skeleton';
import { Spinner } from './Spinner';
import { StatusBadge } from './StatusBadge';

export interface BookingStatusProps {
  type: BookingType;
  bookingId: string;
}

/**
 * FLT-23 / HTL-17: the state of one booking after payment. It asks the backend until the Stripe webhook has
 * confirmed the booking (see `usePollBooking`) and shows one of: waiting, confirmed, expired, cancelled, a
 * "taking longer than usual" message with a refresh button, or a load error with a retry.
 */
export function BookingStatus({ type, bookingId }: BookingStatusProps) {
  const { phase, booking, error, refresh } = usePollBooking(type, bookingId);
  const noun = type === 'flight' ? 'booking' : 'reservation';

  if (phase === 'loading') {
    return (
      <div aria-busy="true">
        <Spinner label={`Loading your ${noun}`} />
        <Skeleton lines={3} />
      </div>
    );
  }

  if (phase === 'unavailable') {
    return (
      <Alert variant="warning" title={`This ${noun} is no longer open`} hint="It has expired or been cancelled. Nothing is waiting for payment.">
        <p>We cannot show its details any more.</p>
      </Alert>
    );
  }

  if (phase === 'error' || !booking) {
    const friendly = toFriendlyError(error);
    return (
      <Alert variant="error" hint={friendly.hint} onRetry={refresh}>
        {friendly.message}
      </Alert>
    );
  }

  const badge = <StatusBadge status={booking.status} />;

  if (phase === 'confirmed') {
    return (
      <Alert variant="success" title={`Your ${noun} is confirmed`}>
        <p>
          {badge} Booking reference: <strong>{booking.bookingReference ?? '—'}</strong>
        </p>
      </Alert>
    );
  }

  if (phase === 'expired') {
    return (
      <Alert variant="warning" title="Time to pay ran out" hint={`Nothing was charged. Start a new ${noun} to try again.`}>
        <p>{badge} The hold on this {noun} has expired and was released.</p>
      </Alert>
    );
  }

  if (phase === 'cancelled') {
    return (
      <Alert variant="warning" title={`This ${noun} was cancelled`}>
        <p>{badge}</p>
      </Alert>
    );
  }

  if (phase === 'timeout') {
    return (
      <Alert
        variant="warning"
        title="Still waiting for confirmation"
        hint="Your payment may need a little longer. Refresh to check again."
        onRetry={refresh}
        retryLabel="Refresh status"
      >
        <p>{badge} We have not heard back from the payment yet.</p>
      </Alert>
    );
  }

  return (
    <Alert variant="info" title="Confirming your payment">
      <p>
        {badge} This usually takes a few seconds. Keep this page open.
      </p>
      {booking.holdExpiresAt ? (
        <p>
          <Countdown expiresAt={booking.holdExpiresAt} onExpire={refresh} />
        </p>
      ) : null}
    </Alert>
  );
}
