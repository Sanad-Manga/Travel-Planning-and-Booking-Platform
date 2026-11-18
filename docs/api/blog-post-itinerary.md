# Attach an itinerary to a post (BLG-13, bonus)

`PATCH /api/posts/:id/itinerary` (logged in). Body:

```json
{ "itineraryId": "674a1b2c3d4e5f6a7b8c9d0e" }
```

`{ "itineraryId": null }` removes the attached itinerary. A post has at most one. The answer is the post (`PostResponseDto`) with `itineraryId` (string or null).

## Who may attach what

- Only the **post's author**, and only **one of their own itineraries** (private or public). Checked in `PostItineraryService`, not the controller.
- A private itinerary may be attached; readers just do not see it until it becomes public.
- `itineraryId` cannot be set through `PATCH /api/posts/:id` (400, unknown field).

## What readers see

`GET /api/posts/:id` has `itinerary`: the same row as `GET /api/itineraries/public/search` (`id`, `authorId`, `title`, `countryCodes`, `startDate`, `dayCount`, `updatedAt`), or `null`.
It is shown only when the itinerary is `PUBLIC`, not hidden, and its author is `ACTIVE`: the same rule as `GET /api/itineraries/public/:id` (ITN-20/21), so a post never links to an itinerary that would 404. Making the itinerary private again hides it from the next request on. A deleted itinerary shows as `null`.

`GET /api/posts/:id` is a public route, and the global guard does not read the login cookie on public routes, so the author sees the same as everyone. The author gets `itineraryId` back from the PATCH.

## Errors

| Case | Status |
|---|---|
| `itineraryId` missing, not a valid id and not null, unknown field | 400 with `details` |
| Not logged in | 401 |
| Unknown or malformed post id, someone else's post | 404 `Post not found` |
| Itinerary does not exist or is not the caller's own (also a public one) | 404 `Itinerary not found` |

## Cross-module reads (read only)

The `Itinerary` model registered read-only in `BlogModule` (added for BLG-12) and the itineraries module's `toPublicItineraryRow` mapper; `UsersService.isActive` for the author check. No other module is edited. `Post` gets one optional field, `itineraryId` (reference to `itineraries._id`).
