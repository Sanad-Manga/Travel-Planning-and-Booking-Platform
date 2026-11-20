import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto';

const run = (plain: Record<string, unknown>) => {
  const dto = plainToInstance(UpdateProfileDto, plain);
  const errors = validateSync(dto);
  return { dto, fields: errors.map((e) => e.property), messages: errors.flatMap((e) => Object.values(e.constraints ?? {})) };
};

describe('UpdateProfileDto', () => {
  it('accepts an empty object (the service requires at least one field)', () => {
    expect(run({}).fields).toEqual([]);
  });

  describe('name', () => {
    it('is trimmed', () => expect(run({ name: '  Ali Hassan  ' }).dto.name).toBe('Ali Hassan'));
    it.each(['', '   '])('rejects an empty name (%p)', (name) => expect(run({ name }).fields).toEqual(['name']));
    it('rejects more than 100 characters', () => expect(run({ name: 'a'.repeat(101) }).fields).toEqual(['name']));
    it('accepts exactly 100 characters', () => expect(run({ name: 'a'.repeat(100) }).fields).toEqual([]));
    it.each([null, 5, ['x']])('rejects a non-string name (%p)', (name) => expect(run({ name }).fields).toEqual(['name']));
  });

  describe('phone', () => {
    it.each([
      ['+20 100 123 4567', '+201001234567'],
      ['(010) 0123-4567', '01001234567'],
      ['0100.123.4567', '01001234567'],
      ['+14155552671', '+14155552671'],
      ['1234567', '1234567'],
      ['123456789012345', '123456789012345'],
    ])('accepts and normalizes %s', (input, stored) => {
      const { dto, fields } = run({ phone: input });
      expect(fields).toEqual([]);
      expect(dto.phone).toBe(stored);
    });

    it('accepts an empty string, which means "remove my phone number"', () => {
      const { dto, fields } = run({ phone: '   ' });
      expect(fields).toEqual([]);
      expect(dto.phone).toBe('');
    });

    it.each(['123456', '1234567890123456', 'abc1234567', '+', '++201001234567', '12+3456789', '0100-ABC-4567'])(
      'rejects %s',
      (phone) => expect(run({ phone }).fields).toEqual(['phone']),
    );

    it.each([null, 1234567, ['1234567']])('rejects a non-string phone (%p)', (phone) => expect(run({ phone }).fields).toEqual(['phone']));
  });

  describe('preferredCurrency', () => {
    it('is trimmed and upper-cased', () => expect(run({ preferredCurrency: ' eur ' }).dto.preferredCurrency).toBe('EUR'));
    it.each(['EU', 'EURO', 'E1R', '', '€€€', 'U SD'])('rejects the malformed code %p', (preferredCurrency) =>
      expect(run({ preferredCurrency }).fields).toEqual(['preferredCurrency']),
    );
    it.each([null, 123, ['USD']])('rejects a non-string currency (%p)', (preferredCurrency) =>
      expect(run({ preferredCurrency }).fields).toEqual(['preferredCurrency']),
    );
  });

  it('reports every invalid field at once', () => {
    expect(run({ name: '', phone: 'x', preferredCurrency: '1' }).fields.sort()).toEqual(['name', 'phone', 'preferredCurrency']);
  });
});
