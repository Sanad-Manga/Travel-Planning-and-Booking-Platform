import { describe, expect, it } from 'vitest';
import { itineraryFormSchema } from './itineraryForm';

const valid = { title: 'Egypt', countryCodes: ['EG'], startDate: '2026-12-20' };
const messages = (input: unknown) => {
  const result = itineraryFormSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
};

describe('itineraryFormSchema (ITN-01, same rules as the backend DTO)', () => {
  it('accepts a title, one country and a real date, and trims the title', () => {
    expect(itineraryFormSchema.parse({ ...valid, title: '  Egypt  ' }).title).toBe('Egypt');
  });

  it('needs a title of at most 100 characters', () => {
    expect(messages({ ...valid, title: '   ' })).toEqual(['title: Enter a title.']);
    expect(messages({ ...valid, title: 'x'.repeat(101) })).toEqual(['title: Use at most 100 characters.']);
    expect(messages({ ...valid, title: 'x'.repeat(100) })).toEqual([]);
  });

  it('needs at least one country', () => {
    expect(messages({ ...valid, countryCodes: [] })).toEqual(['countryCodes: Choose at least one country.']);
  });

  it.each(['', '2026-02-30', '20/12/2026'])('rejects the start date "%s"', (startDate) => {
    expect(messages({ ...valid, startDate })).toEqual(['startDate: Choose a start date.']);
  });
});
