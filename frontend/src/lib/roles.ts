/**
 * ACC-04: the four roles (contracts section 5), where each lands after login, and which header links
 * each sees. This only decides what to show: the backend enforces roles on every request.
 */

export const ROLES = ['USER', 'ADMIN', 'AIRLINE_MODERATOR', 'HOTEL_MODERATOR'] as const;
export type Role = (typeof ROLES)[number];

/** ACC-11: the only page a user with a temporary password may use (besides logging out). */
export const FORCED_PASSWORD_PATH = '/change-password';

export interface NavLink {
  label: string;
  href: string;
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

const HOME_PATHS: Record<Role, string> = {
  USER: '/',
  ADMIN: '/admin',
  AIRLINE_MODERATOR: '/airline',
  HOTEL_MODERATOR: '/hotel',
};

export function homePathFor(role: Role): string {
  return HOME_PATHS[role];
}

const HOME: NavLink = { label: 'Home', href: '/' };
const BLOG: NavLink = { label: 'Blog', href: '/blog' };
const TRAVEL: NavLink[] = [
  { label: 'Flights', href: '/flights' },
  { label: 'Hotels', href: '/hotels' },
  { label: 'Itineraries', href: '/itineraries' },
];

const ROLE_LINKS: Record<Role, NavLink[]> = {
  USER: [HOME, ...TRAVEL, BLOG, { label: 'My bookings', href: '/bookings' }],
  ADMIN: [HOME, BLOG, { label: 'Admin', href: '/admin' }],
  AIRLINE_MODERATOR: [HOME, BLOG, { label: 'Airline', href: '/airline' }],
  HOTEL_MODERATOR: [HOME, BLOG, { label: 'Hotel', href: '/hotel' }],
};

/** Links for the main navigation. `null` is a guest. */
export function navLinksFor(role: Role | null): NavLink[] {
  return role ? ROLE_LINKS[role] : [HOME, ...TRAVEL, BLOG];
}

/** While the session is still loading nothing role-specific is shown, only what every visitor can use. */
export const NEUTRAL_NAV_LINKS: NavLink[] = [HOME, BLOG];
