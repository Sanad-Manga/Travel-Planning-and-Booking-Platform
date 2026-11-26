import { describe, expect, expectTypeOf, it } from 'vitest';
import type { BodyOf, Page, QueryOf, ResponseOf, Schema } from './types';
import { withQuery } from './types';

describe('withQuery', () => {
  it('adds only the values that are set', () => {
    expect(withQuery('/api/airports', { page: 2, limit: 10 })).toBe('/api/airports?page=2&limit=10');
    expect(withQuery('/api/airports', { page: undefined, q: '' })).toBe('/api/airports');
    expect(withQuery('/api/airports')).toBe('/api/airports');
  });

  it('encodes values', () => {
    expect(withQuery('/api/x', { q: 'a b&c' })).toBe('/api/x?q=a+b%26c');
  });
});

describe('generated API types', () => {
  it('describe the real backend DTOs', () => {
    expectTypeOf<Schema<'CountryResponseDto'>>().toHaveProperty('code').toBeString();
    expectTypeOf<Schema<'CountryResponseDto'>>().toHaveProperty('currency').toBeString();
    expectTypeOf<ResponseOf<'/api/countries'>['items'][number]>().toEqualTypeOf<Schema<'CountryResponseDto'>>();
    expectTypeOf<ResponseOf<'/api/auth/me'>>().toEqualTypeOf<Schema<'UserResponseDto'>>();
    expectTypeOf<QueryOf<'/api/airports'>>().toHaveProperty('page');
    expectTypeOf<BodyOf<'/api/auth/login', 'post'>>().toHaveProperty('email').toBeString();
  });

  it('match the shared pagination envelope', () => {
    expectTypeOf<ResponseOf<'/api/airports'>>().toMatchTypeOf<Page<unknown>>();
  });
});
