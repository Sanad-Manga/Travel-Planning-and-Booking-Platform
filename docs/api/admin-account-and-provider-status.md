# Admin: suspend moderators, deactivate providers (ACC-15)

Requirement ACC-15 (SCRUM-76). Module: `backend/src/admin/`. Every route is **ADMIN only** (`@Roles(Role.ADMIN)`):
a guest gets 401, any other role gets 403. All routes take **no request body** (a non-empty body is a 400).

## 1. Suspend / reactivate an account (USER or moderator)

| Route | Transition |
| --- | --- |
| `PATCH /api/admin/accounts/:id/suspend` | `ACTIVE -> SUSPENDED` |
| `PATCH /api/admin/accounts/:id/reactivate` | `SUSPENDED -> ACTIVE` |

These routes come from ACC-16 (USER only). ACC-15 widens the target role scope to `AIRLINE_MODERATOR` and
`HOTEL_MODERATOR`. Everything else is unchanged: the status transition is one conditional update, a repeat call is a
200 no-op, an `ACCOUNT_SUSPENDED` / `ACCOUNT_REACTIVATED` notification and one audit entry
(`USER_SUSPENDED` / `USER_REACTIVATED`, `targetType: 'User'`) are written per real change.

Response `200`: `{ "id": "<accountId>", "status": "SUSPENDED" | "ACTIVE" }`

| Status | When |
| --- | --- |
| 400 | `:id` is not an ObjectId, or a body was sent |
| 401 / 403 | not logged in / not an ADMIN |
| 404 | no such account |
| 409 | the target is an **ADMIN** (`Only USER and moderator accounts can be suspended or reactivated here`), the admin targets themselves, or the account is not in the source status (e.g. DEACTIVATED) |
| 500 | persistence failure, or audit failed after the change (retry recovers it, see the Admin README) |

- A suspended moderator cannot log in. The existing login answers **403 `Account suspended`** (not the generic 401).
  The old access cookie gets **401 at once**, because the global guard checks the account status on every request.
  Reactivation restores login and the old cookie.
- Suspending a moderator **never changes their hotel or airline**: `hotelId` / `airlineId` and the provider's
  `isActive` stay as they were.

## 2. Deactivate / reactivate a provider (hotel or airline)

| Route | Effect |
| --- | --- |
| `PATCH /api/admin/providers/:type/:id/deactivate` | `isActive: true -> false` |
| `PATCH /api/admin/providers/:type/:id/reactivate` | `isActive: false -> true` |

`:type` is `hotel` or `airline`; `:id` is the provider's ObjectId.

Response `200`: `{ "id": "<providerId>", "type": "hotel", "isActive": false }`

| Status | When |
| --- | --- |
| 400 | `:type` is not `hotel` / `airline`, `:id` is not an ObjectId, or a body was sent (standard `details` entries with `field` `type` / `id`) |
| 401 / 403 | not logged in / not an ADMIN |
| 404 | no hotel/airline with that id of that type (`Provider not found`) |
| 409 | already in the requested state (`Provider is already deactivated` / `Provider is already active`) |
| 500 | persistence failure, or the audit write failed |

How it works:

- ONE atomic conditional update (`{ _id, isActive: <current> }` then `$set isActive`). Parallel or repeated calls change
  the provider once; the others get 409 and write nothing.
- It is **separate from suspending the moderator**: no user is modified. Deactivating a hotel does not suspend its
  moderators, and suspending a moderator does not deactivate the hotel.
- It **never reads or writes a booking**. Existing `CONFIRMED` bookings stay valid and unchanged.
- **Deactivate** notifies every moderator linked to the provider (`users.hotelId` / `users.airlineId` equal to the
  provider id, role `HOTEL_MODERATOR` / `AIRLINE_MODERATOR`) with `NotificationType.PROVIDER_DEACTIVATED`. A provider
  with no moderators still succeeds. One audit entry: `PROVIDER_DEACTIVATED`, `targetType` `Hotel` / `Airline`,
  `details { before, after, moderatorsNotified }`.
- **Reactivate** writes one audit entry (`PROVIDER_REACTIVATED`) and **no notification**: there is no
  provider-reactivated value in the shared `NotificationType` enum and `common/` was not changed. Open question for the lead.
- Failure handling: the flag is flipped first, then the audit entry is written. If the audit write fails, the flag is
  put back with a conditional update and the response is 500 `Provider status was not changed because audit logging
  failed` (or, if even the revert fails, 500 saying the change stands). `NotificationsService.notify` never throws, so a
  failed notification never undoes the change. This differs from ACC-16, which keeps a retry journal: here a simple
  revert was chosen, so a retry after a 500 starts from a clean state.
- Seam used: the admin module registers the `Hotel` and `Airline` Mongoose models itself
  (`MongooseModule.forFeature`, the same way it already registers `User`). `AirlinesModule` exports only
  `AirlinesService` and `HotelsService` has no write method for `isActive`, so no exported service could do the write.
- `User.airlineId` / `User.hotelId` are `Mixed` in the User schema (no casting). The moderator lookup therefore
  matches both an ObjectId and a string value.

## 3. "Hidden from search and not bookable": what each module does today

Checked with real HTTP tests (`backend/test/provider-status.e2e-spec.ts`), deactivating through the admin route.

| Area | Owner | Respects `isActive` today? | Proof |
| --- | --- | --- | --- |
| Hotel search `GET /api/hotels/search` (HTL-11) | Ziad | Yes (`isActive: true` filter) | deactivated hotel absent, back after reactivation |
| Free rooms `GET /api/hotels/:id/rooms/available` (HTL-15) | Ziad | Yes (404 `Hotel not found`) | 404 while deactivated, 200 after |
| Hotel booking `POST /api/hotel-bookings` (HTL-16) | Hessain | Yes (404 `Hotel not found` for a NEW booking) | 404 while deactivated, 201 after |
| Flight search `GET /api/flights/search` | Ahmed | Yes (inactive airlines filtered out) | flight absent, back after reactivation |
| Flight details `GET /api/flights/:id` | Ahmed | Yes (404) | 404 while deactivated, 200 after |
| Flight hold `POST /api/flight-bookings/hold` | Abdulrahman / Ahmed | Yes, through `FlightInventoryService.loadBookableFlight` (409 `This airline is not open for booking`) | 409 while deactivated, 201 after |

No gap was found, so nothing in another owner's module had to change. The booking-time checks only apply to NEW
bookings, which is what keeps existing CONFIRMED bookings valid.

Not covered (not asked by the ticket): notifying travellers with existing bookings; blocking moderators from editing a
deactivated provider's profile (`FlightsService.create` already refuses new flights for a deactivated airline).

## 4. Swagger examples

```
PATCH /api/admin/accounts/<hotelModeratorId>/suspend            -> 200 { "id": "...", "status": "SUSPENDED" }
PATCH /api/admin/accounts/<adminId>/suspend                     -> 409 (admins cannot be suspended / self)
PATCH /api/admin/providers/hotel/<hotelId>/deactivate           -> 200 { "id": "...", "type": "hotel", "isActive": false }
PATCH /api/admin/providers/hotel/<hotelId>/deactivate (again)   -> 409 Provider is already deactivated
PATCH /api/admin/providers/airline/<airlineId>/reactivate       -> 200 { "id": "...", "type": "airline", "isActive": true }
PATCH /api/admin/providers/flight/<id>/deactivate               -> 400 details: [{ "field": "type", ... }]
PATCH /api/admin/providers/hotel/<unknownId>/deactivate         -> 404 Provider not found
```
