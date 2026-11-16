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
// FreeRoom = { roomId, hotelId, name, type, beds, maxOccupancy, pricePerNightCents }  (beds added by HTL-15)
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
all rooms in **one** query. `HotelBookingsService` implements this contract and is bound by `HotelsModule`. Its one
query includes overlapping CONFIRMED reservations and only unexpired PENDING_PAYMENT holds. The same overlap rule is
checked inside the transaction that creates a reservation, so a room selected from the list is not trusted as still
available.

## Free rooms of one hotel (HTL-15)

`GET /api/hotels/:id/rooms/available` (public, no login). Used by the hotel details page (HTL-02) and as the room
list the traveler selects from (HTL-16).

| Query | Rule |
|---|---|
| `checkIn`, `checkOut` | `YYYY-MM-DD`. `checkOut` after `checkIn`; `checkIn` not before today (UTC). Same rules as the search. |
| `page`, `limit` | Shared pagination (default 1 / 10, max 50). A page past the end is `items: []`. |

There is no `guests` or `rooms` parameter (the ticket does not ask for one); other query fields are a 400.
`:id` must be an ACTIVE hotel; an unknown, malformed or deactivated id is `404 Hotel not found`.

Returns `{ items, page, limit, total, totalPages }`. Each item is one room that is free for **every night** of the stay
(the same `HotelAvailabilityService.findFreeRooms` as the search, not a second rule):

```json
{ "roomId": "6730a1f2c3d4e5f607182940", "name": "101", "type": "Double", "beds": 2, "maxOccupancy": 3,
  "pricePerNightCents": 8500, "totalCents": 25500,
  "checkIn": "2027-03-10", "checkOut": "2027-03-13", "nights": 3, "currency": "USD" }
```

`totalCents` = `nights x pricePerNightCents` (integer cents). The stay fields repeat on each item because the shared
pagination envelope has no room for extra top-level fields. Sorted by `pricePerNightCents`, then `name`, then `roomId`.

**Selecting rooms.** There is no select or hold endpoint in this ticket. The client lets the traveler tick one or more
items and keeps their `roomId`s with `checkIn`/`checkOut`; HTL-16 (Hessain) receives those `roomId`s. A room can be taken
between this list and the booking, so HTL-16/18 must re-check availability and hold atomically. Until Hessain binds a
real `RoomReservations`, rooms with a confirmed reservation or an unexpired hold are still listed (see above).

## Hotel details page (HTL-02)

`GET /api/hotels/:id` (public, no login). One call for everything the hotel page shows. `:id` must be an ACTIVE hotel;
an unknown, malformed or deactivated id is `404 Hotel not found`.

| Query | Rule |
|---|---|
| `checkIn`, `checkOut` | Optional, but both or neither (one alone is a 400 on the missing one). Same rules as HTL-15: `YYYY-MM-DD`, `checkOut` after `checkIn`, `checkIn` not before today (UTC). |
| `page`, `limit` | Shared pagination of the `rooms` list (default 1 / 10, max 50). Ignored without dates. |

Other query fields are a 400. The hotel is checked first, so an unknown hotel is a 404 whatever the dates are.

```json
{ "id": "6730...", "name": "Nile View Hotel", "address": "12 Corniche El Nil", "cityId": "CAI", "countryCode": "EG",
  "description": "...", "photos": [{ "id": "p1", "url": "/uploads/p1.jpg" }], "starRating": 4, "amenities": ["wifi", "pool"],
  "policies": { "hotelId": "6730...", "checkInTime": "14:00", "checkOutTime": "11:00",
                "cancellationTiers": [{ "daysBeforeThreshold": 7, "refundPercent": 100 }] },
  "averageRating": null, "reviewCount": 0, "reviews": [],
  "rooms": null }
```

- `policies` is `HotelsService.getPolicies` (HTL-09/HTL-10): times are `null` until the moderator sets them,
  `cancellationTiers` is `[]` when nothing is refunded. The same data PAY-02 shows at booking time.
- `rooms` is `null` without dates (no rooms are returned). With dates it is the **HTL-15 page** (`HotelFreeRoomsService.listFreeRooms`,
  same items, order and paging as `GET /api/hotels/:id/rooms/available`; no second availability rule). `{ "items": [] ... }`
  means no room is free; `null` means rooms were not asked for.
- `averageRating` / `reviewCount` / `reviews`: the reviews module (HTL-23/HTL-24, Hotels B) is not on develop yet, so the
  stable empty shape is returned (`null`, `0`, `[]`). The review item shape (`id`, `rating`, `comment`, `authorName`,
  `createdAt`) is provisional. When that module merges, only `HotelDetailsService.loadReviews` changes (visible, non-hidden reviews only).
- Route order: `HotelDetailsController` is registered after `HotelSearchController`, so `GET /hotels/search` is never read as an id.
