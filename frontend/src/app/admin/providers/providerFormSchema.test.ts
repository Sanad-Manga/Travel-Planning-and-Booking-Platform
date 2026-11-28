import { expect, it } from 'vitest';
import { providerFormSchema, type ProviderFormValues } from './providerFormSchema';

const empty: ProviderFormValues = {
  type: 'airline', name: '', code: '', address: '', countryCode: '', cityId: '', description: '', starRating: '', amenities: '',
};
const hotel: ProviderFormValues = {
  ...empty, type: 'hotel', name: ' Example Hotel ', address: ' 1 Test Street ', countryCode: 'EG',
  cityId: 'CAI', description: ' Near the river ', starRating: '4', amenities: ' Wifi, Pool, wifi,\n Gym, , POOL',
};
function issues(input: ProviderFormValues) {
  return providerFormSchema.safeParse(input).error?.issues.map(({ path }) => path.join('.'));
}

it('trims airline fields and uppercases a valid ASCII code while omitting hotel fields', () => {
  expect(providerFormSchema.parse({ ...hotel, type: 'airline', name: ' Example Air ', code: ' ab9 ' }))
    .toEqual({ type: 'airline', body: { name: 'Example Air', code: 'AB9' } });
});

it.each([
  ['', ''], ['A', 'A'], ['x'.repeat(101), 'ABCD'], ['Example', 'A-'], ['Example', 'ß1'],
])('rejects invalid airline names or codes', (name, code) => {
  expect(issues({ ...empty, name, code })).toContain('code');
});

it('requires airline name and code and enforces the name length range', () => {
  for (const name of [' ', 'A', 'x'.repeat(101)]) expect(issues({ ...empty, name })).toEqual(['name', 'code']);
});

it('normalizes a complete hotel payload and removes duplicate or blank amenities', () => {
  expect(providerFormSchema.parse(hotel)).toEqual({
    type: 'hotel', body: { name: 'Example Hotel', address: '1 Test Street', cityId: 'CAI',
      description: 'Near the river', starRating: 4, amenities: ['Wifi', 'Pool', 'Gym'] },
  });
  const noAmenities = providerFormSchema.parse({ ...hotel, amenities: ' ,\n ' });
  expect(noAmenities.body).not.toHaveProperty('amenities');
});

it('requires the hotel name, address, country, city, description and stars', () => {
  expect(issues({ ...empty, type: 'hotel' })).toEqual(['name', 'address', 'countryCode', 'cityId', 'description', 'starRating']);
});

it.each([
  ['name', 'x'.repeat(101)], ['address', 'x'.repeat(201)], ['description', 'x'.repeat(2001)],
  ['cityId', 'x'.repeat(51)], ['starRating', '4.5'], ['starRating', '0'], ['starRating', '6'],
  ['amenities', 'x'.repeat(51)], ['amenities', Array.from({ length: 31 }, (_, index) => 'a'+index).join(',')],
] as const)('rejects hotel values outside the backend limits for %s', (field, value) => {
  expect(issues({ ...hotel, [field]: value })).toContain(field);
});
