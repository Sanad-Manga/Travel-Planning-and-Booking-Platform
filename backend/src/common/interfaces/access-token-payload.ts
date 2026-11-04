import { Role } from '../enums';

/** Claims inside the access-token JWT. `sub` is the user id. The guard turns these into an AuthenticatedUser. */
export interface AccessTokenPayload {
  sub: string;
  role: Role;
  airlineId?: string;
  hotelId?: string;
}
