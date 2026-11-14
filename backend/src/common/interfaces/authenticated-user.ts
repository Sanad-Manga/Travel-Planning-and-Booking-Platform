import { Role } from '../enums';

/**
 * The authenticated principal that `@CurrentUser()` returns (docs/contracts.md section 4).
 * A moderator has exactly one of `airlineId` / `hotelId`.
 */
export interface AuthenticatedUser {
  userId: string;
  tokenVersion?: number;
  role: Role;
  airlineId?: string;
  hotelId?: string;
}
