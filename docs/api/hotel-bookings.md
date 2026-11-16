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

## My reservations (HTL-20)

Both routes are for the authenticated `USER` only (admins and moderators get 403). A reservation is private to its
owner: someone else's reservation, like an unknown id, answers 404.

`GET /api/hotel-bookings?group=UPCOMING|PAST|CANCELLED&page=1&limit=10` lists the traveler's own reservations. Every row
carries its `group`. Without `group` everything is listed, newest first. The answer is the usual page envelope
(`items`, `page`, `limit`, `total`, `totalPages`). Each row shows `id`, `bookingReference` (after payment), the
`hotel` (`id`, `name`, `cityId`), `checkIn`, `checkOut`, `nights`, `rooms` (name, type, adults, children), `guests`
(adults and children in all rooms), `totalCents`, `currency`, `status`, `group` and, while payment is pending,
`holdExpiresAt`. Payment data (`paymentRef`) is never returned.

A reservation is in exactly one group (dates are UTC, `today` is the UTC date):

| Group | Which reservations | Order |
|---|---|---|
| `UPCOMING` | `CONFIRMED` with `checkOut` after today (a stay in progress is still upcoming), and `PENDING_PAYMENT` with a live hold | Soonest check-in first |
| `PAST` | `COMPLETED`, and `CONFIRMED` with `checkOut` today or earlier (BookingLifecycle may not have completed it yet, so the date decides) | Latest check-out first |
| `CANCELLED` | `CANCELLED`, `EXPIRED`, and `PENDING_PAYMENT` whose hold has run out (a hold that ends exactly now has run out) | Most recently changed first |

`GET /api/hotel-bookings/:id` returns one reservation in full: the same fields, the hotel's `address` and check-in and
check-out times, each room with `maxOccupancy`, `pricePerNightCents` and `totalCents` as captured when the
reservation was made, `createdAt`, and `refund`.

`refund` is `{ status, amountCents }` (`RefundStatus`) once Payments (PAY-03) records a refund for the reservation.
Until PAY-03 exists on `develop` there is no refund record to read, so it is always `null`. A malformed id is a 400
on `id`.

The hotel of a reservation is looked up in one query, hidden (inactive) hotels included. If the hotel record is gone
the row keeps its `hotel.id` and shows the name `Hotel no longer listed`.

## Reservation lookups

`RoomReservations.findReservedRoomIds(roomIds, startDate, endDate)` returns rooms with an overlapping `CONFIRMED`
reservation or an unexpired `PENDING_PAYMENT` hold. The same overlap rule is checked inside the booking transaction.
`hasConfirmedReservation` answers only for confirmed reservations.

The hotel booking service registers as the `BookingType.HOTEL` provider for `BookingLifecycle` and as the hotel
`UpcomingBookingsChecker` for account deactivation. Upcoming means a `CONFIRMED` reservation whose check-in date is
today or later in UTC. Reviews are not part of this module; the deleted-author display is handled when that module exists.
