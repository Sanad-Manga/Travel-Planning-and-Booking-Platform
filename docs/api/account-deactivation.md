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

State today: both owners are registered, so both block. Hotels: `HotelBookingsService.hasUpcomingConfirmedBookings`
(`checkIn >= today`). Flights: `FlightBookingProvider.hasUpcomingConfirmedBookings` (`flights/flight-booking.provider.ts`).
The flight check is one aggregation, stopped at the first match: it starts from the `{ userId }` index of `flightBookings`, keeps
`CONFIRMED` bookings, reads the flight ids of every leg (`segments.flightId`; a legacy booking without `segments` uses its top-level
`flightId`), joins them to `flights` by `_id` (primary key) and answers true when any leg has `departureAt >= now`. A round trip therefore blocks
while any leg is still ahead. Several bookings or passengers make no difference (one match is enough, passengers live inside the booking).
A database error is thrown, never turned into `false`, so the deactivation fails and nothing changes.
Proven by `flight-booking.upcoming.spec.ts` (unit) and `test/flight-deactivation-block.e2e-spec.ts` (real checkers through `DELETE /api/users/me`).

Known limit: the booking check and the status change are two steps in two collections, so a booking confirmed in the
instant between them is not caught. A concurrent double deactivation is safe (one atomic `ACTIVE -> DEACTIVATED` update; one call wins, the other gets 401).

## What other modules must do for a `DEACTIVATED` author

The users module only flips the status. Each module decides what it shows (no other module was edited for ACC-12).
State on develop when this was written:

| Content | Required | State today | Owner |
|---|---|---|---|
| Comments | author shows as `Deleted user` | Done: `blog/comments.service.ts` (`'Deleted user'` for a `DEACTIVATED` author) | Yusuf |
| Public itineraries | hidden from public search | Done: `itineraries.service.ts` `searchPublic` keeps only authors for whom `UsersService.isActive` is true | yassin |
| Posts | hidden | Done: `blog.service.ts` leaves a `DEACTIVATED` author out of the public list, the search and the tag list (part of the database filter, so totals and pages stay correct) and answers `GET /api/posts/:id` with the same 404 as an unknown post. The ids come from `UsersService.findDeactivatedIds` / `isDeactivated` | Yusuf |
| Reviews | author shows as `Deleted user` | **Not done**: no reviews module on develop yet. When it exists, show `Deleted user` for a `DEACTIVATED` author like comments do | Hessain |

## What is hidden for a DEACTIVATED author, and what is not (ACC-12, #153)

Nothing is deleted. Every rule below is evaluated from the user's current status on each request, so a user whose
status becomes `ACTIVE` again sees all of it return (there is no API route for that today: `PATCH /api/admin/accounts/:id/reactivate` only handles `SUSPENDED`).

Hidden from everyone except admins (same 404 as an unknown id, so existence is not revealed):

- `GET /api/posts`, `GET /api/posts?q=...`, `GET /api/tags/:tag/posts`: the author's published posts are not listed.
- `GET /api/posts/:id`, `GET /api/posts/:id/comments`, `POST /api/posts/:id/comments`, `POST /api/posts/:id/like`: 404.
- `GET /api/authors/:id` (the author page) and `GET /api/itineraries/public/*` / the public itinerary search (already done before).
- The itinerary attached to a post (`visibleItinerary`: already `null` for a non-ACTIVE author).
- Post images `GET /uploads/<id>.jpg|png`: 404 for guests and other users (they are served like a hidden post).

Still visible:

- The author's comments and hotel reviews on other people's content, shown with the name `Deleted user`.
- Bookings, which stay valid. The author's own drafts and `/api/posts/mine` are unreachable only because the author cannot log in.

Known limit: `GET /api/posts/:id` and the images route cannot show the post to an admin through the normal public route,
because that route is `@Public()` and never reads the caller's cookie (this is the same for the existing hidden-post rule).
`GET /uploads/...` does read the cookie and lets an admin through; the comments route lets an admin through; the detail route
keeps the admin exception in the service but needs an optional-authentication change in `common/` to use it (raised with the lead).
