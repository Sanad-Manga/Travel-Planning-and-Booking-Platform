import { expect, it } from 'vitest';
import { moderatorFormSchema } from './moderatorFormSchema';

const valid = {
  name: '  Synthetic Name  ', email: '  Account@Example.test  ', role: 'AIRLINE_MODERATOR',
  provider: { id: '6730a1f2c3d4e5f607182931', kind: 'airline', name: 'Example Airline', isActive: false },
  temporaryPassword: '  سفر99  ',
};

it('requires all fields', () => {
  const result = moderatorFormSchema.safeParse({});
  expect(result.error?.issues.map((issue) => issue.path[0])).toEqual(['name', 'email', 'role', 'provider', 'temporaryPassword']);
});

it('normalizes identity for both roles and preserves Unicode password whitespace', () => {
  expect(moderatorFormSchema.parse(valid)).toMatchObject({
    name: 'Synthetic Name', email: 'account@example.test', temporaryPassword: valid.temporaryPassword,
  });
  expect(moderatorFormSchema.safeParse({ ...valid, role: 'HOTEL_MODERATOR', provider: { ...valid.provider, kind: 'hotel' } }).success).toBe(true);
});

it.each([
  ['name', ' ', 'name'],
  ['name', 'x'.repeat(101), 'name'],
  ['email', 'not an email', 'email'],
  ['email', 'a'.repeat(250) + '@example.test', 'email'],
  ['role', 'USER', 'role'],
  ['role', 'ADMIN', 'role'],
  ['role', '', 'role'],
  ['provider', null, 'provider'],
  ['provider', { ...valid.provider, id: 'bad' }, 'provider'],
  ['provider', { ...valid.provider, kind: 'hotel' }, 'provider'],
  ['temporaryPassword', 'Ab1', 'temporaryPassword'],
  ['temporaryPassword', '123456789', 'temporaryPassword'],
  ['temporaryPassword', 'ArabicOnly١', 'temporaryPassword'],
  ['temporaryPassword', 'é'.repeat(36) + '1', 'temporaryPassword'],
] as const)('rejects invalid %s input', (field, value, path) => {
  const result = moderatorFormSchema.safeParse({ ...valid, [field]: value });
  expect(result.error?.issues.some((issue) => issue.path[0] === path)).toBe(true);
});

it('accepts a password at the UTF-8 byte limit', () => {
  expect(moderatorFormSchema.safeParse({ ...valid, temporaryPassword: 'é'.repeat(35) + '12' }).success).toBe(true);
});
