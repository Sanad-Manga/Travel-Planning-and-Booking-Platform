import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PolicySummary } from './PolicySummary';

const flight = (extra: object = {}) =>
  ({
    bookingType: 'FLIGHT',
    bookingId: 'b1',
    cancellationTiers: [
      { daysBeforeThreshold: 0, refundPercent: 0 },
      { daysBeforeThreshold: 14, refundPercent: 100 },
      { daysBeforeThreshold: 7, refundPercent: 50 },
    ],
    baggagePolicy: { airlineId: 'a1', extraBagPriceCents: 3000, currency: 'USD', maxExtraBags: 2 },
    ...extra,
  }) as never;

describe('PolicySummary (PAY-02)', () => {
  it('lists the cancellation tiers largest first, in words', () => {
    render(<PolicySummary type="flight" policies={flight()} />);
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Cancelling 14 days or more before departure: 100% refund',
      'Cancelling 7 days or more before departure: 50% refund',
      'Any other cancellation before departure: 0% refund',
    ]);
  });

  it('shows the airline baggage policy with the price from cents', () => {
    render(<PolicySummary type="flight" policies={flight()} />);
    expect(screen.getByText('Each extra bag costs $30.00. You can add up to 2 extra bags.')).toBeInTheDocument();
  });

  it('says so when the airline has no baggage policy or no refunds', () => {
    render(<PolicySummary type="flight" policies={flight({ baggagePolicy: null, cancellationTiers: [] })} />);
    expect(screen.getByText('The airline has not published a baggage policy.')).toBeInTheDocument();
    expect(screen.getByText('This airline does not refund cancellations.')).toBeInTheDocument();
  });

  it('shows hotel check-in and check-out times and "check-in" wording', () => {
    const policies = {
      bookingType: 'HOTEL',
      bookingId: 'b1',
      cancellationTiers: [{ daysBeforeThreshold: 3, refundPercent: 80 }],
      checkInTime: '14:00',
      checkOutTime: '11:00',
    } as never;
    render(<PolicySummary type="hotel" policies={policies} />);
    expect(screen.getByText('Cancelling 3 days or more before check-in: 80% refund')).toBeInTheDocument();
    expect(screen.getByText('Check-in from 14:00. Check-out by 11:00.')).toBeInTheDocument();
    expect(screen.queryByText('Baggage')).not.toBeInTheDocument();
  });
});
