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

## Reservation lookups

`RoomReservations.findReservedRoomIds(roomIds, startDate, endDate)` returns rooms with an overlapping `CONFIRMED`
reservation or an unexpired `PENDING_PAYMENT` hold. The same overlap rule is checked inside the booking transaction.
`hasConfirmedReservation` answers only for confirmed reservations.

The hotel booking service registers as the `BookingType.HOTEL` provider for `BookingLifecycle` and as the hotel
`UpcomingBookingsChecker` for account deactivation. Upcoming means a `CONFIRMED` reservation whose check-in date is
today or later in UTC. Reviews are not part of this module; the deleted-author display is handled when that module exists.
