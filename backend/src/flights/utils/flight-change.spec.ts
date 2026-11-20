import { fareDifferenceCents, replacementTotalCents } from './flight-change';

describe('flight change pricing (FLT-27)', () => {
  const counts = { adults: 2, children: 1, infants: 1 };

  it('reuses the booking passenger counts and stored segment baggage fee', () => {
    // 3 seats at 45,000 + 1 infant at 4,500 + 3,000 baggage.
    expect(replacementTotalCents({ baggageFeeCents: 3000 }, 45000, counts)).toBe(
      142500,
    );
  });

  it('reports a zero difference when the replacement total is unchanged', () => {
    expect(fareDifferenceCents(142500, 142500)).toBe(0);
  });

  it('reports positive and negative differences in integer cents', () => {
    expect(fareDifferenceCents(142500, 150000)).toBe(7500);
    expect(fareDifferenceCents(142500, 140000)).toBe(-2500);
  });
});
