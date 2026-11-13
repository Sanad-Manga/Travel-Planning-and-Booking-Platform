# Hotel search and the free-room function (HTL-11)

## Endpoint

`GET /api/hotels/search` (public, no login).

| Query | Rule |
|---|---|
| `cityId` **or** `countryCode` | Seeded `city_id` / country code. Exactly one; none or both is a 400. A code that is not seeded is a 400, not an empty list. |
| `checkIn`, `checkOut` | `YYYY-MM-DD`. `checkOut` after `checkIn`; `checkIn` not before today (UTC). |
| `guests` | Whole number 1-100. |
| `rooms` | Whole number 1-10, default 1. |
| `page`, `limit` | Shared pagination (default 1 / 10, max 50). A page past the end is `items: []`. |

Returns `{ items, page, limit, total, totalPages }`. Each item: `id, name, cityId, cityName, countryCode, countryName,
starRating, freeRooms, nights, cheapestTotalCents, currency`. Sorted by `cheapestTotalCents`, then name, then id.
A hotel is returned if it is ACTIVE and at least `rooms` rooms are free for the whole stay and **some choice of exactly
`rooms` of them** sleeps `guests` people together. `cheapestTotalCents` = nights x the cheapest such choice (a "from"
price). It is a feasibility check only: nothing is held or booked (HTL-16/18 re-check).

## `HotelAvailabilityService.findFreeRooms` (exported from `HotelsModule`)

```ts
findFreeRooms(hotelIds: string[], checkIn: string, checkOut: string): Promise<FreeRoom[]>
// FreeRoom = { roomId, hotelId, name, type, maxOccupancy, pricePerNightCents }
```

For HTL-15 (room list of one hotel), ITN-25 (itineraries) and the hold (HTL-18). Inject `HotelAvailabilityService`
(`imports: [HotelsModule]`). Two queries for any number of hotels (one on `rooms`, one `RoomReservations` call).
It does not check the hotel (ACTIVE, city): the caller chooses the hotels.

A room is free for `[checkIn, checkOut)` only if:

1. `room.isActive`;
2. its `availability` ranges cover **every night** `checkIn ... checkOut-1`. Ranges are half-open
   (`startDate <= night < endDate`), so a range ending on the check-out day is enough. **Adjacent ranges are merged**
   (one ends the day the next starts); a one-night gap makes the room not free;
3. not blocked: the schema has **no blocked ranges** today (HTL-05 only edits ranges and rooms). If they are added,
   filter them in this one method;
4. not reserved or held, asked through `RoomReservations`.

## Contract for Hessain: `RoomReservations.findReservedRoomIds`

Added next to the existing method (`hasConfirmedReservation` is unchanged):

```ts
abstract findReservedRoomIds(roomIds: string[], startDate: string, endDate: string): Promise<Set<string>>;
```

Return the ids (strings) of the rooms that **cannot be sold** for `[startDate, endDate)`: a CONFIRMED reservation or an
unexpired PENDING_PAYMENT hold overlaps it (`checkIn < endDate AND checkOut > startDate`; contracts section 8). Answer for
all rooms in **one** query. `HotelsModule` binds a stub (`NoRoomReservations`, nothing reserved); replace it with
`{ provide: RoomReservations, useClass: ... }` as for `hasConfirmedReservation`. Until then search shows rooms that a
booking may already hold.
