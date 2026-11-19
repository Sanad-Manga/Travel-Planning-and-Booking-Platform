# Room status per date range (HTL-08)

## Endpoint

`GET /api/hotels/:id/availability` (hotel moderator, **own hotel only**).

| Query | Rule |
|---|---|
| `from`, `to` | `YYYY-MM-DD`, real calendar dates, **both included**. `to` not before `from`; at most 62 days (`ROOM_STATUS_MAX_DAYS`). Past dates are allowed (a moderator may look back). |
| `page`, `limit` | Shared pagination over the **rooms** (default 1 / 10, max 50). Rooms are ordered by name, numbers in natural order (`2` before `10`). |

Returns `{ items, page, limit, total, totalPages }`. Each item is a room:
`{ roomId, name, type, isActive, days: [{ date, status, reservation?, blockedReason? }] }`.
`days` has **one entry per date** from `from` to `to`, ascending. A date stands for the night that starts on it.

## The status of a date (exactly one)

| `status` | When | Extra fields |
|---|---|---|
| `BOOKED` | A reservation covers the night (`checkIn <= date < checkOut`): `CONFIRMED`, or `PENDING_PAYMENT` with an unexpired hold (the same claim the availability check and the hold use). Expired holds and cancelled stays do not count. | `reservation: { id, reference, status, checkIn, checkOut }`. `reference` is the guest-facing booking reference (`HTL-...`); it is `null` while the reservation is only a hold, because it is assigned when payment confirms it. |
| `BLOCKED` | Not booked and not sellable. | `blockedReason`: `ROOM_DEACTIVATED` (room taken out of sale), `BLOCKED_RANGE` (date inside a moderator-blocked range, HTL-06), `NOT_OFFERED` (no availability range, HTL-04, covers the date). |
| `AVAILABLE` | Active room, offered for the date, not blocked, not reserved. | none |

Precedence: `BOOKED` > `BLOCKED` > `AVAILABLE`. A night that is both booked and blocked (block added after the booking) is
reported once, as `BOOKED`: the stay exists and the moderator must see its reference.

## Errors

| Code | When |
|---|---|
| 400 | Missing / impossible date, `to` before `from`, range over 62 days, bad `page`/`limit`, unknown query field. `details: [{ field, message }]`. |
| 401 | Not logged in. |
| 403 | Not a hotel moderator, or not this moderator's own hotel (checked in `HotelRoomStatusService`, also for an unknown or malformed hotel id). |
| 404 | The moderator's own hotel no longer exists. |

## Notes for the other hotel owners

* Reservations are read from the `hotelBookings` collection with one query per page (rooms of the page, overlap with the range),
  read-only; `RoomReservations` cannot be used because it answers "is it reserved?" without the reference.
* Blocked ranges are read from `room.blockedRanges` (the field HTL-06 adds, `[{ startDate, endDate }]`, half-open like
  availability ranges). Until HTL-06 is merged nobody writes it, so `BLOCKED_RANGE` never appears on develop; no code change
  is needed here once it merges (the schema type can then replace the local `RoomWithBlocks` type in `hotel-room-status.service.ts`).
* Cost: 3 queries per request (room count, rooms of the page, reservations of those rooms); the days are computed in memory.
