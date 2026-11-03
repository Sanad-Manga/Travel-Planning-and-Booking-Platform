import { validate } from 'class-validator';
import { PLATFORM_CURRENCY } from '../../common/constants';
import { MoneyDto } from './money.dto';

function makeDto(amountCents: unknown, currency: unknown): MoneyDto {
  const dto = new MoneyDto();
  (dto as any).amountCents = amountCents;
  (dto as any).currency = currency;
  return dto;
}

describe('MoneyDto validation', () => {
  it('passes for a valid non-negative integer amount in the platform currency', async () => {
    const errors = await validate(makeDto(1999, PLATFORM_CURRENCY));
    expect(errors).toHaveLength(0);
  });

  it('passes for zero', async () => {
    const errors = await validate(makeDto(0, PLATFORM_CURRENCY));
    expect(errors).toHaveLength(0);
  });

  it('fails for a negative amount', async () => {
    const errors = await validate(makeDto(-1, PLATFORM_CURRENCY));
    expect(errors.some((e) => e.property === 'amountCents')).toBe(true);
  });

  it('fails for a non-integer (float) amount', async () => {
    const errors = await validate(makeDto(19.99, PLATFORM_CURRENCY));
    expect(errors.some((e) => e.property === 'amountCents')).toBe(true);
  });

  it('fails for any currency other than the platform currency', async () => {
    const errors = await validate(makeDto(1999, 'EUR'));
    expect(errors.some((e) => e.property === 'currency')).toBe(true);
  });

  it('fails for a missing currency', async () => {
    const errors = await validate(makeDto(1999, undefined));
    expect(errors.some((e) => e.property === 'currency')).toBe(true);
  });
});
