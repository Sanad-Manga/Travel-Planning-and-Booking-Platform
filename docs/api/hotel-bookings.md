# Hotel bookings (HTL-16)

## Create a reservation

`POST /api/hotel-bookings` (authenticated `USER` only).

The client sends the stay dates and selected `roomId`s returned by
`GET /api/hotels/:id/rooms/available`, with the adults and children assigned to each room:

```json
{
  "checkIn": "2027-03-10",
  "checkOut": "2027-03-13",
  "rooms": [
    { "roomId": "6730a1f2c3d4e5f607182940", "adults": 2, "children": 1 }
  ]
}
```

All rooms must belong to one active hotel and be available throughout the stay. The API re-checks availability and
overlapping reservations in a MongoDB transaction. It creates one `PENDING_PAYMENT` hotel booking with a
`HOLD_MINUTES` expiry. A per-room write in the transaction serializes competing holds. If a selected room is no longer
available, the request returns 409 and no booking is created.

The reservation is stored in `hotelBookings`:

| Field | Meaning |
|---|---|
| `userId`, `hotelId` | Traveler and the one hotel for the reservation |
| `checkIn`, `checkOut`, `nights` | Date-only stay and derived night count |
| `rooms[]` | `roomId`, assigned adult/child counts, and room detail/price snapshots |
| `totalCents`, `currency` | Sum of all room stay totals in platform currency |
| `status`, `holdExpiresAt` | Shared `BookingStatus`; pending hold and expiry |
| `paymentRef`, `bookingReference` | Added on successful payment confirmation |

Each room snapshot stores `pricePerNightCents` and `totalCents = nights x pricePerNightCents`, so later room price
changes do not alter the reservation.

Response: the created reservation DTO (`id`, hotel, dates, room snapshots, total, status and `holdExpiresAt`).

## Payment confirmation (HTL-17)

After payment succeeds, the booking provider atomically changes the single reservation to `CONFIRMED`, removes the
hold expiry, generates a unique `bookingReference`, and creates an in-app notification. Repeated confirmation for the
same payment reference is idempotent. The same provider method is used when `BookingLifecycle` resolves a late-paid
hold; it receives the payment reference and does not depend on a Stripe event object.

The owning traveler can read the reservation and confirmation with `GET /api/hotel-bookings/:id`. The endpoint
returns 404 for an invalid, missing, or another traveler's booking. In the response, `bookingReference` is null until
confirmation and `holdExpiresAt` is null once the hold has been consumed.

## Atomic room holds (HTL-18)

The same `POST /api/hotel-bookings` request creates one `PENDING_PAYMENT` reservation and holds every selected room
until `holdExpiresAt` (`HOLD_MINUTES`, 10 minutes by default). Availability, blocked ranges, and overlapping
reservations are rechecked in one MongoDB transaction. If a selected room overlaps a `CONFIRMED` reservation, an
unexpired `PENDING_PAYMENT` hold, or a moderator-defined blocked range, the whole request returns 409 and holds no
rooms. Concurrent attempts for the same room are serialized so only one can succeed.

The `BookingLifecycle` expiry sweep changes due holds to `EXPIRED`; expired reservations no longer count as inventory
claims, so the rooms become available again. Check-out must be after check-in, and check-in cannot be in the past.

## Cancel a whole reservation (HTL-21)

Both routes are for the authenticated `USER` who owns the reservation (admins and moderators get 403). Someone else's
reservation, an unknown id and a malformed id answer 404.

`GET /api/hotel-bookings/:id/cancel-preview` shows the refund before cancelling and changes nothing:

```json
{
  "bookingId": "6730a1f2c3d4e5f607182950",
  "checkIn": "2027-03-10",
  "checkInAt": "2027-03-10T15:00:00.000Z",
  "daysBeforeCheckIn": 12.5,
  "totalCents": 25500,
  "currency": "USD",
  "refundCents": 12750,
  "nonRefundableCents": 12750
}
```

`POST /api/hotel-bookings/:id/cancel` (no body) cancels the reservation as a whole. There is no partial cancellation.
It answers 200 with `{ booking, refund }`: `booking` is the reservation, now `CANCELLED`, and `refund` is the refund
PAY-03 created (`id`, `status`, `amountCents`, `currency`, `createdAt`) or `null` when no tier applies.

Rules:

- Only a `CONFIRMED` reservation can be cancelled, and only before check-in. Any other status, or a check-in moment that
  has passed, is a 409 (the preview answers the same 409).
- The check-in moment is the check-in date at the hotel's check-in time (HTL-09), in UTC. A hotel that never set a time
  counts from 00:00 of the check-in day.
- The refund is `RefundCalculator.compute` (Payments) applied to the hotel's cancellation tiers (HTL-10), the days from
  now to the check-in moment and the full reservation total. It is the same amount the preview showed. A hotel without
  tiers, or a cancellation closer to check-in than every tier, refunds 0: the reservation is still cancelled, nothing is
  sent to Stripe and `refund` is `null`.
- The status change goes through `BookingLifecycle` (`CONFIRMED` to `CANCELLED`). It is one atomic write, so two
  simultaneous cancellations give one 200 and one 409, and only the winner creates a refund. A `CANCELLED` reservation
  no longer holds its rooms: they are available again for those dates in the same write.
- The refund is created with `RefundsService.issue` (PAY-03), after the status change. If that call fails (for example
  Stripe is down) the reservation stays `CANCELLED`, the error is logged and returned, and the refund has to be handled
  by hand: a second cancel is a 409.

## Reservation lookups

`RoomReservations.findReservedRoomIds(roomIds, startDate, endDate)` returns rooms with an overlapping `CONFIRMED`
reservation or an unexpired `PENDING_PAYMENT` hold. The same overlap rule is checked inside the booking transaction.
`hasConfirmedReservation` answers only for confirmed reservations.

The hotel booking service registers as the `BookingType.HOTEL` provider for `BookingLifecycle` and as the hotel
`UpcomingBookingsChecker` for account deactivation. Upcoming means a `CONFIRMED` reservation whose check-in date is
today or later in UTC.

## Checkout completion and reviews (HTL-23)

A `CONFIRMED` stay becomes `COMPLETED` after its checkout date has passed in UTC. The hotel booking service runs a daily
completion sweep, and an owner's `GET /api/hotel-bookings/:id` also completes an overdue stay before returning it.
Status changes go through `BookingLifecycle.transition()`.

The owner may submit one review per completed reservation, regardless of how many rooms it contains:

`POST /api/hotel-bookings/:id/review` (authenticated `USER` only):

```json
{ "rating": 5, "comment": "Clean rooms and a great view." }
```

`rating` is an integer from 1 through 5. `comment` is optional and limited to 1000 characters. A duplicate review, a
review before checkout, or a review for another traveler's reservation returns 409, 409, or 404 respectively. The
author may edit either field with `PATCH /api/reviews/:id` and delete the review with `DELETE /api/reviews/:id`.
Another traveler receives 404 for attempts to edit or delete it.

Visible review averages and counts are recalculated after create, edit, and delete. The public
`GET /api/hotels/:id` response includes `averageRating`, `reviewCount`, and visible reviews newest first. Hidden reviews
are excluded. Reviews by deactivated authors show `Deleted user`.
