import { Role } from '../enums';

/** Claims inside the access-token JWT. `sub` is the user id. The guard turns these into an AuthenticatedUser. */
export interface AccessTokenPayload {
  sub: string;
  tokenVersion?: number;
  role: Role;
  airlineId?: string;
  hotelId?: string;
}

/** Missing version is legacy zero, never the current version of a reset account. */
export function readTokenVersion(value: unknown): number | null {
  if (value === undefined) return 0;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
