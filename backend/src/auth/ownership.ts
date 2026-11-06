import { NotFoundException } from '@nestjs/common';
import { AuthenticatedUser, Role } from '../common';

/**
 * Shared ownership rules (ACC-11, docs/contracts.md section 4). Pure functions: no database, no Nest DI,
 * so any service can import them:
 *
 *   import { assertCanViewBooking, assertOwner, bookingVisibilityFilter } from '../auth/ownership';
 *
 * Each module maps its own schema fields onto {@link OwnedResource}; the helper depends on no schema.
 * A private resource that is not yours is a 404 (never 403), so its existence is not revealed.
 * Wrong ROLE (403) is decided elsewhere (RolesGuard); this file only decides ownership and visibility.
 * It only reads: bookings change status through BookingLifecycle, never here.
 */

/** The ids of a resource, as each module maps them. ObjectId and string are both fine. */
export interface OwnedResource {
  ownerId?: unknown;
  airlineId?: unknown;
  hotelId?: unknown;
}

/** Field names used by {@link bookingVisibilityFilter}; override when a collection names them differently. */
export interface BookingFilterFields {
  ownerField?: string;
  airlineField?: string;
  hotelField?: string;
}

/** A plain Mongo filter. */
export type OwnershipFilter = Record<string, unknown>;

/** Compares two ids as strings. An undefined, null or empty id never matches anything. */
function sameId(a: unknown, b: unknown): boolean {
  if (a === undefined || a === null || b === undefined || b === null)
    return false;
  const left = String(a);
  const right = String(b);
  return left !== '' && left === right;
}

/** Owner only (itineraries, drafts, notifications). An ADMIN is NOT allowed here. */
export function isOwner(
  user: AuthenticatedUser,
  resource: OwnedResource,
): boolean {
  return sameId(user.userId, resource.ownerId);
}

/** Throws 404 with the caller's "not found" message unless the user owns the resource. */
export function assertOwner(
  user: AuthenticatedUser,
  resource: OwnedResource,
  notFoundMessage: string,
): void {
  if (!isOwner(user, resource)) throw new NotFoundException(notFoundMessage);
}

/**
 * Who may view a booking: its owner, any ADMIN, an AIRLINE_MODERATOR of the booking's airline,
 * or a HOTEL_MODERATOR of the booking's hotel. Everyone else (other moderators, a moderator without an
 * airlineId/hotelId, an airline moderator on a hotel booking, other users) may not.
 */
export function canViewBooking(
  user: AuthenticatedUser,
  resource: OwnedResource,
): boolean {
  if (isOwner(user, resource)) return true;
  switch (user.role) {
    case Role.ADMIN:
      return true;
    case Role.AIRLINE_MODERATOR:
      return sameId(user.airlineId, resource.airlineId);
    case Role.HOTEL_MODERATOR:
      return sameId(user.hotelId, resource.hotelId);
    default:
      return false;
  }
}

/** Throws 404 with the caller's "not found" message unless {@link canViewBooking} allows the user. */
export function assertCanViewBooking(
  user: AuthenticatedUser,
  resource: OwnedResource,
  notFoundMessage: string,
): void {
  if (!canViewBooking(user, resource))
    throw new NotFoundException(notFoundMessage);
}

/**
 * Mongo filter for LIST endpoints: merge it into the query so a user only ever lists what they may view.
 * USER -> own bookings; ADMIN -> everything; AIRLINE_MODERATOR -> their airline; HOTEL_MODERATOR -> their hotel.
 * A moderator without the needed id (or an unknown role) gets a filter that matches nothing.
 * Ids are returned as given (strings); Mongoose casts them to ObjectId for ObjectId schema paths.
 */
export function bookingVisibilityFilter(
  user: AuthenticatedUser,
  fields: BookingFilterFields = {},
): OwnershipFilter {
  const {
    ownerField = 'userId',
    airlineField = 'airlineId',
    hotelField = 'hotelId',
  } = fields;
  const matchNothing: OwnershipFilter = { _id: { $in: [] } };
  switch (user.role) {
    case Role.USER:
      return user.userId ? { [ownerField]: user.userId } : matchNothing;
    case Role.ADMIN:
      return {};
    case Role.AIRLINE_MODERATOR:
      return user.airlineId ? { [airlineField]: user.airlineId } : matchNothing;
    case Role.HOTEL_MODERATOR:
      return user.hotelId ? { [hotelField]: user.hotelId } : matchNothing;
    default:
      return matchNothing;
  }
}
