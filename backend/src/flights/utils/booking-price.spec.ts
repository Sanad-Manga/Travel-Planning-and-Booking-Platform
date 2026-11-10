import {
  bookingTotalCents,
  infantFareCents,
  seatsNeeded,
} from './booking-price';

describe('booking price (FLT-22)', () => {
  it('infants take no seat: seats = adults + children', () => {
    expect(seatsNeeded({ adults: 2, children: 1, infants: 2 })).toBe(3);
    expect(seatsNeeded({ adults: 1, children: 0, infants: 1 })).toBe(1);
  });

  it('an infant pays 10% of the fare, rounded to the nearest cent', () => {
    expect(infantFareCents(45000)).toBe(4500);
    expect(infantFareCents(45005)).toBe(4501); // 4500.5 rounds up
    expect(infantFareCents(44994)).toBe(4499); // 4499.4 rounds down
    expect(infantFareCents(0)).toBe(0);
  });

  it('total = (adults + children) x fare + infants x infant fare, in integer cents', () => {
    expect(bookingTotalCents(45000, { adults: 2, children: 1, infants: 1 })).toBe(
      3 * 45000 + 4500,
    );
    expect(bookingTotalCents(45000, { adults: 1, children: 0, infants: 0 })).toBe(45000);
  });

  it('always returns a whole number of cents', () => {
    const total = bookingTotalCents(12345, { adults: 3, children: 2, infants: 3 });
    expect(Number.isInteger(total)).toBe(true);
  });
});
