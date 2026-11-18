# Favourites (BON-02, bonus)

A registered user saves hotels and public itineraries to their own favourites list. All routes need a login (guest: 401).

| Method | Path | What |
|---|---|---|
| POST | `/api/favourites` | Save an item. Body `{ "type": "HOTEL" \| "ITINERARY", "itemId": "<id>" }`. 201 when saved, 200 when it was already saved (same favourite, no duplicate). |
| GET | `/api/favourites?page=1&limit=10` | My list, newest first, shared pagination (default 10, max 50). |
| DELETE | `/api/favourites/:id` | Remove one of my favourites (204). |

## Row

`id`, `type`, `itemId`, `name` (hotel name or itinerary title), `available`, `addedAt`.

## Rules

- Only an **existing, active hotel** (`isActive: true`) or a **public itinerary** (PUBLIC, not hidden, author ACTIVE: `ItinerariesPublicService.loadPublic`, the same rule as `GET /api/itineraries/public/:id`) can be saved. Otherwise 404 `Hotel not found` / `Itinerary not found`.
- **No duplicates:** a unique index on `(userId, type, itemId)`. A second save, also two at the same time, returns the existing favourite with 200.
- **Own list only:** every query filters on the logged-in user's id. Someone else's favourite id on DELETE is 404.
- If a saved item later stops being available (hotel deactivated or deleted, itinerary made private, hidden, deleted or its author not active), it stays in the list with `available: false` and `name: null`, so nothing private is shown. The user can remove it.

## Errors

| Case | Status |
|---|---|
| Not logged in | 401 |
| `type` not HOTEL/ITINERARY, `itemId` not a valid id, missing or unknown field, bad page/limit | 400 with `details` |
| Hotel unknown or deactivated, itinerary unknown or not public | 404 |
| DELETE: unknown, malformed or someone else's favourite | 404 |

## Cross-module reads (read only)

Hotels and itineraries are referenced by id only. `FavouritesModule` imports `HotelsModule` (for the Hotel model it exports) and `ItinerariesModule` (for `ItinerariesPublicService`). Neither module is edited. `FavouritesModule` is registered in `app.module.ts`.
