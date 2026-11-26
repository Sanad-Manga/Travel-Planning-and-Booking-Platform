import { describe, expect, it } from 'vitest';
import { FORCED_PASSWORD_PATH, homePathFor, isRole, navLinksFor, type Role } from './roles';

const labels = (role: Role | null) => navLinksFor(role).map((l) => l.label);

describe('homePathFor (ACC-04)', () => {
  it.each([
    ['USER', '/'],
    ['ADMIN', '/admin'],
    ['AIRLINE_MODERATOR', '/airline'],
    ['HOTEL_MODERATOR', '/hotel'],
  ] as const)('%s lands on %s', (role, path) => {
    expect(homePathFor(role)).toBe(path);
  });
});

describe('isRole', () => {
  it('accepts the four roles only', () => {
    expect(isRole('ADMIN')).toBe(true);
    expect(isRole('SUPERUSER')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});

describe('navLinksFor (ACC-04)', () => {
  it('a guest sees the public destinations', () => {
    expect(labels(null)).toEqual(['Home', 'Flights', 'Hotels', 'Itineraries', 'Blog']);
  });

  it('a USER also sees My bookings', () => {
    expect(labels('USER')).toEqual(['Home', 'Flights', 'Hotels', 'Itineraries', 'Blog', 'My bookings']);
    expect(navLinksFor('USER').find((l) => l.label === 'My bookings')?.href).toBe('/bookings');
  });

  it.each([
    ['ADMIN', 'Admin', '/admin'],
    ['AIRLINE_MODERATOR', 'Airline', '/airline'],
    ['HOTEL_MODERATOR', 'Hotel', '/hotel'],
  ] as const)('%s sees Home, Blog and their own area only', (role, label, href) => {
    expect(labels(role)).toEqual(['Home', 'Blog', label]);
    expect(navLinksFor(role).find((l) => l.label === label)?.href).toBe(href);
  });

  it('everyone sees Blog', () => {
    for (const role of [null, 'USER', 'ADMIN', 'AIRLINE_MODERATOR', 'HOTEL_MODERATOR'] as const) {
      expect(labels(role)).toContain('Blog');
    }
  });

  it('the forced password path is /change-password', () => {
    expect(FORCED_PASSWORD_PATH).toBe('/change-password');
  });
});
