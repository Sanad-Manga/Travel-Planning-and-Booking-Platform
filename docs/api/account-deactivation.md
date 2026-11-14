# Self-deactivate account (ACC-12, SCRUM-73)

Owner: Ziad Mohamed (users). `DELETE /api/users/me`

A logged-in user deactivates their own account. Nothing is deleted: the user, bookings, posts and itineraries stay in
the database; only `status` changes from `ACTIVE` to `DEACTIVATED`.

## Request

```http
DELETE /api/users/me
Cookie: access_token=...
Content-Type: application/json

{ "confirm": true }
```

`confirm` must be exactly the boolean `true`. Missing, `false`, `"true"` (a string) or any extra field is a 400.
Only role `USER` may call it (decision to confirm with the lead: deactivating the only admin or a provider's moderator
would lock out the platform; staff are deactivated by an admin, see the admin module).

## Responses

| Status | When | Notes |
|---|---|---|
| 200 | Deactivated | `{ "message": "Account deactivated" }`. Both auth cookies are cleared in the response. |
| 400 | `confirm` missing, not exactly `true`, or an unknown field | Standard shape with `details: [{ "field": "confirm", "message": "confirm must be true to deactivate your account" }]` |
| 401 | Not logged in, token invalid or expired, account already not `ACTIVE` | Also what a second or parallel call gets |
| 403 | Role is `ADMIN`, `AIRLINE_MODERATOR` or `HOTEL_MODERATOR` | Account stays `ACTIVE` |
| 409 | The user has an upcoming `CONFIRMED` flight or hotel booking | Account stays `ACTIVE`. The message names no booking and no personal data. |

After success:

- The old access cookie gets the standard 401 at once on every endpoint (the global `JwtAuthGuard` checks the status on every request).
- `POST /api/auth/login` returns the same generic 401 as a wrong password, and the login lockout counters are untouched. `POST /api/auth/refresh` is rejected too.
- The refresh token is not revoked by this route: its cookie is scoped to `/api/auth` and is never sent to `/api/users/me`, and a refresh for a non-`ACTIVE` account is rejected anyway.

## What "upcoming" means

Only `CONFIRMED` bookings block. A booking is upcoming when its start has not passed:

| Booking | Blocks? |
|---|---|
| `CONFIRMED`, flight departs at or after now (UTC instant) | yes |
| `CONFIRMED`, hotel check-in date is today or later (UTC date) | yes |
| `CONFIRMED` but already started or ended (in progress, past) | no |
| `PENDING_PAYMENT` (unpaid hold, expires by itself) | no |
| `CANCELLED`, `EXPIRED`, `COMPLETED` | no |

## Contract for Flights B (Abdulrahman) and Hotels B (Hessain)

`BookingProvider` in payments has no "bookings of a user" query, so the users module publishes its own seam
(`backend/src/users/upcoming-bookings.ts`, exported by `UsersModule`):

```ts
interface UpcomingBookingsChecker {
  hasUpcomingConfirmedBookings(userId: string, now: Date): Promise<boolean>;
}
// UpcomingBookingsRegistry.register(type: BookingType, checker)
```

Each owner implements the checker on their own booking collection and registers it on module init, like
`BookingProviderRegistry`:

```ts
// in the module that owns the bookings (import UsersModule there)
onModuleInit() { this.upcomingBookings.register(BookingType.FLIGHT, this); } // or BookingType.HOTEL
```

Rules for the implementation: a cheap indexed `exists` query on `{ userId, status: CONFIRMED }` plus the start
condition above (flights: `departureAt >= now` of the flight, for a round trip any leg not yet departed; hotels: check-in
date `>= now` as `YYYY-MM-DD`). On a database error it must throw, not return `false`: the deactivation then fails and
nothing changes.

State today: the flight booking schema exists on develop (`flightBookings`: `userId`, `status`, `flightId`) but nothing is
registered yet, and hotel bookings do not exist yet. **Until a type registers, it blocks nothing.** The blocking rule is
proven end to end with a test double of the checker; the real flight and hotel checks are to be written by their owners.

Known limit: the booking check and the status change are two steps in two collections, so a booking confirmed in the
instant between them is not caught. A concurrent double deactivation is safe (one atomic `ACTIVE -> DEACTIVATED` update; one call wins, the other gets 401).

## What other modules must do for a `DEACTIVATED` author

The users module only flips the status. Each module decides what it shows (no other module was edited for ACC-12).
State on develop when this was written:

| Content | Required | State today | Owner |
|---|---|---|---|
| Comments | author shows as `Deleted user` | Done: `blog/comments.service.ts` (`'Deleted user'` for a `DEACTIVATED` author) | Yusuf |
| Public itineraries | hidden from public search | Done: `itineraries.service.ts` `searchPublic` keeps only authors for whom `UsersService.isActive` is true | yassin |
| Posts | hidden | **Not done**: a published post stays in `GET /api/posts` and opens at `GET /api/posts/:id` with the author's real name. Needs an author-status check in the list filter (`blog.service.ts`, the `filter` around line 91) and in `canView` (around line 339), e.g. through `UsersService.isActive` like itineraries | Yusuf |
| Reviews | author shows as `Deleted user` | **Not done**: no reviews module on develop yet. When it exists, show `Deleted user` for a `DEACTIVATED` author like comments do | Hessain |
