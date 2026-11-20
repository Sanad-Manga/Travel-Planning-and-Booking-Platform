# Ownership helper (ACC-11)

Shared rules for "who may see this resource". Pure functions in `backend/src/auth/ownership.ts`: no database,
no Nest DI, no knowledge of any module's schema. (The ticket said `common/`; the lead asked for it to stay in `auth/`.)

```ts
import { assertCanViewBooking, assertOwner, bookingVisibilityFilter } from '../auth/ownership';
```

Call them from the **service**, not the controller (docs/contracts.md section 4). Map your own fields onto
`{ ownerId, airlineId?, hotelId? }`. ObjectId and string ids both work; an undefined, null or empty id never matches.

| Function | Allowed | Use for |
|---|---|---|
| `isOwner` / `assertOwner(user, resource, notFoundMessage)` | the owner only (an ADMIN is **not** allowed) | itineraries, drafts, notifications |
| `canViewBooking` / `assertCanViewBooking(user, resource, notFoundMessage)` | the owner, any `ADMIN`, an `AIRLINE_MODERATOR` whose `airlineId` equals the booking's, a `HOTEL_MODERATOR` whose `hotelId` equals the booking's | single booking reads |
| `bookingVisibilityFilter(user, fields?)` | returns a Mongo filter | booking LIST endpoints |

`bookingVisibilityFilter`: `USER` -> `{ userId }`, `ADMIN` -> `{}`, `AIRLINE_MODERATOR` -> `{ airlineId }`,
`HOTEL_MODERATOR` -> `{ hotelId }`. Override names with `{ ownerField, airlineField, hotelField }`. A moderator
without the needed id gets `{ _id: { $in: [] } }`, which matches nothing. Merge it into your query with `$and`
or spread it, and keep the filter keys distinct from your own.

Rejections are **404** with the message you pass, never 403, so the response does not reveal that the resource
exists. Pass the same message you use for a truly missing id. Wrong role (403) stays with `RolesGuard`. The
helper only reads: bookings change status only through `BookingLifecycle`.

```ts
async getBooking(user: AuthenticatedUser, id: string) {
  const booking = await this.model.findById(id).lean();
  if (!booking) throw new NotFoundException('Booking not found');
  assertCanViewBooking(
    user,
    { ownerId: booking.userId, airlineId: booking.airlineId, hotelId: booking.hotelId },
    'Booking not found',
  );
  return toDto(booking);
}

list(user: AuthenticatedUser) {
  return this.model.find({ ...bookingVisibilityFilter(user), status: 'CONFIRMED' });
}
```

Tests: `src/auth/ownership.spec.ts` (every rule) and `test/ownership.e2e-spec.ts` (real MongoDB, real users and
ObjectIds, test-only module that is never registered in `AppModule`).
