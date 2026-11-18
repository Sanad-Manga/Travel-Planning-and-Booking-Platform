# Public author page (BLG-12)

`GET /api/authors/:id?page=1&limit=10` (public, no login). Shows an author's public profile, their published posts and their public itineraries.

| Query | Rule |
|---|---|
| `page`, `limit` | Shared `PaginationDto` (default 10 per page, at most 50; 400 otherwise). They apply to **both** lists, so page 2 gives page 2 of the posts and page 2 of the itineraries. |

## Response

```json
{
  "id": "6730a1f2c3d4e5f607182900",
  "name": "Sara Ahmed",
  "joinedAt": "2026-10-01T09:00:00.000Z",
  "posts": { "items": [], "page": 1, "limit": 10, "total": 0, "totalPages": 0 },
  "itineraries": { "items": [], "page": 1, "limit": 10, "total": 0, "totalPages": 0 }
}
```

- Profile: only `id`, `name` and `joinedAt` (the account's `createdAt`). Never email, role, status, password hash or tokens.
- `posts.items`: same rows as `GET /api/posts`. Only `PUBLISHED` and not hidden posts (drafts and hidden posts never appear, not even for the author), newest published first.
- `itineraries.items`: same rows as `GET /api/itineraries/public/search`. Only `PUBLIC` and not hidden itineraries, most recently updated first.

## Why two paginated lists in one object

The page is one resource (the author) with two lists. Each list uses `paginate()` from `common` and the standard envelope, so neither can grow without bound. One `page`/`limit` pair keeps the query simple; the frontend asks for the next page when either list has more (`totalPages`).

## Errors

| Case | Status |
|---|---|
| Unknown id, malformed id (not a 24-hex ObjectId) | 404 `Author not found` |
| Account is `DEACTIVATED` | 404 `Author not found` (same answer, so it does not reveal the account exists) |
| Invalid `page` or `limit` | 400 with `details` |

## Account status

- `DEACTIVATED`: 404 (ticket rule).
- `SUSPENDED`: the page opens with the published posts, but the itineraries list is empty. Public itinerary search and `GET /api/itineraries/public/:id` (ITN-20/21) show an itinerary only while its author is `ACTIVE`, so the author page follows the same rule and never links to an itinerary that would 404.

## Cross-module reads (read only)

- Users: `UsersService.findById` (exported by `UsersModule`).
- Itineraries: `ItinerariesModule` has no "public itineraries of one author" method, so `BlogModule` registers the `Itinerary` schema with `MongooseModule.forFeature` and reads it (the schema comment already names Blog (BLG-12) as a reader of `authorId`). Blog never writes to it. The row mapper `toPublicItineraryRow` is reused from the itineraries module, not copied. If the itineraries owner adds a `listPublicByAuthor(authorId, pagination)` method to `ItinerariesPublicService`, the Blog code can switch to it and drop the model registration.
