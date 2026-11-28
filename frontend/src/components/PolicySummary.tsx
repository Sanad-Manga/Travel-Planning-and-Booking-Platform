import type { Schema } from '@/api/types';
import type { BookingType } from '@/api/usePollBooking';
import { describeTier } from '@/lib/cancellationTiers';
import { formatMoney } from '@/lib/formatMoney';
import { Card } from './Card';

export interface PolicySummaryProps {
  type: BookingType;
  policies: Schema<'BookingPoliciesResponseDto'>;
}

/**
 * PAY-02: the provider's policies shown before payment: how much is refunded for a cancellation, plus the baggage
 * policy (airline) or the check-in and check-out times (hotel). Read-only; accepting them is the checkout's checkbox.
 */
export function PolicySummary({ type, policies }: PolicySummaryProps) {
  const event = type === 'flight' ? 'departure' : 'check-in';
  const tiers = [...policies.cancellationTiers].sort((a, b) => b.daysBeforeThreshold - a.daysBeforeThreshold);
  const baggage = policies.baggagePolicy;

  return (
    <Card title="Policies" headingLevel={2}>
      <h3>Cancellation</h3>
      {tiers.length === 0 ? (
        <p>This {type === 'flight' ? 'airline' : 'hotel'} does not refund cancellations.</p>
      ) : (
        <ul>
          {tiers.map((tier) => (
            <li key={tier.daysBeforeThreshold}>{describeTier(tier, event)}</li>
          ))}
        </ul>
      )}

      {type === 'flight' ? (
        <>
          <h3>Baggage</h3>
          {baggage ? (
            <p>
              Each extra bag costs {formatMoney(baggage.extraBagPriceCents, baggage.currency)}. You can add up to {baggage.maxExtraBags} extra{' '}
              {baggage.maxExtraBags === 1 ? 'bag' : 'bags'}.
            </p>
          ) : (
            <p>The airline has not published a baggage policy.</p>
          )}
        </>
      ) : (
        <>
          <h3>Check-in and check-out</h3>
          <p>
            Check-in from {policies.checkInTime ?? 'the time the hotel confirms'}. Check-out by {policies.checkOutTime ?? 'the time the hotel confirms'}.
          </p>
        </>
      )}
    </Card>
  );
}
