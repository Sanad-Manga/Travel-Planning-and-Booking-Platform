# Hotel moderator reservations (HTL-22)

## Endpoint

`GET /api/hotels/:id/reservations` (hotel moderator, **own hotel only**). Read-only.

| Query | Rule |
|---|---|
| `page`, `limit` | Shared pagination (docs/contracts.md section 3): defaults `1` / `10`, `limit` maximum 50. |

The answer is the standard envelope `{ items, page, limit, total, totalPages }`, newest reservation first
(`createdAt` descending, then `_id` descending, so a row never appears on two pages).

Each item is one reservation:

```json
{
  "id": "6730a1f2c3d4e5f607182950",
  "bookingReference": "HTL-1A2B3C4D5E6F7788",
  "guest": { "userId": "6730a1f2c3d4e5f607182920", "name": "Mona Adel" },
  "checkIn": "2027-03-10",
  "checkOut": "2027-03-13",
  "status": "CONFIRMED"
}
```

- `checkIn` / `checkOut` are `YYYY-MM-DD`; `checkOut` is the first day after the stay.
- `status` is the shared `BookingStatus`. Every status is listed, including a `PENDING_PAYMENT` hold, so the
  moderator can see what is currently holding a room.
- `bookingReference` is `null` while the reservation is only a pending hold; it is assigned when payment confirms
  it. Legacy confirmed rows without a reference also return `null` (it is never generated here).
- `guest` is the account that made the reservation. A missing account is shown as `"Deleted user"`.
- Only `userId`, the guest display name, the dates, the status and the reference are selected. Payment references,
  Stripe ids, card data and passport/identity numbers are never read or returned.

## Errors

| Code | When |
|---|---|
| 400 | Invalid `page` or `limit` (or an unknown query field). `details: [{ field, message }]`. |
| 401 | Not logged in. |
| 403 | Not a hotel moderator, or not this moderator's own hotel. Another, unknown or malformed hotel id answers 403, like HTL-01/HTL-08: hotel profiles are public, so there is nothing to hide. |

## Notes for the other hotel owners

- The route is registered in its own `HotelReservationsController` (`@Controller('hotels')`) inside the Hotels
  module, so the existing profile/rooms controller is untouched. The Hotels module wiring only gains the
  controller registration.
- The query lives in `HotelBookingsService.listForHotel` (Hotels B owns the booking collection). Guest names come
  from the exported `UsersService.findById` of the Users module; the service never reads the users collection
  directly and never edits it.
- Read-only by design: there is no write endpoint in this ticket.
