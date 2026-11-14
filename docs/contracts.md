# Project Contracts (v1.3)

**Instructions to the AI assistant reading this:** you are helping one student implement one ticket of a team NestJS + MongoDB project. This file is the team's binding contract. Follow it exactly. If your code would conflict with it, the file wins. If the file seems wrong or incomplete for the ticket, stop and tell the student to raise it with the lead; do not work around it or invent your own version. If the ticket or any needed signature is missing, ask for it before writing code. Before coding, list your assumptions and anything you need from another module. A separate Reviewer AI will check the student's PR against this file and the ticket, using the checklist in section 11, so self-check your output against it.

---

## 1. Stack and layout

- Backend: NestJS + TypeScript + MongoDB Atlas (Mongoose). Frontend: Next.js (later).
- Folders: `backend/`, `frontend/`, `docs/requirements`, `docs/api`, `AI_PROMPTS.txt`, `README.md`, `.env.example`.
- One folder per feature module: `backend/src/<module>/` with `<module>.module.ts`, `.controller.ts`, `.service.ts`, `schemas/`, `dto/`.
- Modules: `auth`, `users`, `admin`, `airlines`, `flights`, `flight-bookings`, `hotels`, `hotel-bookings`, `reviews`, `payments`, `fx`, `refunds`, `notifications`, `uploads`, `audit`, `itineraries`, `blog`, `reports`, `reference-data`, `common`.
- Shared code only in `backend/src/common/` (guards, decorators, enums, pagination, filters, constants). Changing `common/` needs the lead's approval.
- Never edit another person's module. Ask the owner or the lead.

## 2. Git

- Branch from latest `develop`: `feature/<REQ-ID>-short-name`, `fix/...`, `docs/...`.
- Commits: `feat(flights): add round-trip search (FLT-12)`. No "update", "fix", "final".
- PR to `develop`: title includes the requirement ID, description says what changed and who it affects. Small PRs, one coherent unit. No `.env`, no secrets.
- Add every AI prompt that shaped your code to `AI_PROMPTS.txt` (date, student, tool, requirement ID, prompt, how it was used).

## 3. API conventions

- Global prefix `/api`. REST, nouns, plural. Every endpoint has Swagger decorators (`@ApiTags`, `@ApiOperation`, request/response DTOs, `@ApiCookieAuth()`, error responses).
- Validation: global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` with `class-validator` DTOs. Business-rule validation lives in services, never only in DTOs or the frontend.
- **Error response shape** (all errors, via one global exception filter):
  ```json
  { "statusCode": 400, "error": "Bad Request", "message": "Validation failed",
    "details": [ { "field": "email", "message": "email must be valid" } ],
    "path": "/api/auth/register", "timestamp": "2026-11-02T10:00:00.000Z" }
  ```
  Use 400 invalid input, 401 not logged in, 403 wrong role, 404 not found (also for someone else's private resource), 409 conflict (duplicate, overlap, sold out), 423 account locked.
- **Pagination**: query `page` (default 1), `limit` (default 10, max 50). Response:
  ```json
  { "items": [], "page": 1, "limit": 10, "total": 0, "totalPages": 0 }
  ```
  Every list endpoint uses `PaginationDto` and `paginate()` from `common`.
- IDs: Mongo `_id` exposed as string `id`. Response DTOs, not raw documents. Never return password hashes, tokens, or Stripe secrets.
- Dates: ISO 8601 UTC strings (`2026-11-20T14:30:00.000Z`). Flight times are stored in UTC and the airport's IANA time zone is returned alongside so clients can show local time. Date-only fields (stay dates, itinerary start) are `YYYY-MM-DD`.
- Money: one platform currency (PAY-04). Store and return **integer minor units** (cents) in fields named `...Cents`, plus `currency`. Never floats.
- Schemas: `timestamps: true`. Collection names plural camelCase. Add indexes for fields you search or filter on. Use references for shared/independent data, embedding only for bounded child data.
- Reference data (`countries`, `cities`, `airports`, `attractions`, `currencies`) is seeded from the official datasets **keeping the provided IDs**. Never invent IDs. Other modules store those IDs as references. Each airport carries its IANA time zone (from `Airports.csv`), and the supported currencies are the currency codes listed in `Countries.csv` (no separate currency file).

## 4. Auth and authorization

- JWT access + refresh tokens in **httpOnly, Secure, SameSite cookies**. Never in localStorage/sessionStorage or response bodies. `GET /api/auth/me` returns the current user.
- Session expires after 30 minutes without authenticated requests. Logout clears cookies and revokes the refresh token.
- Roles (`common/enums`): `USER`, `ADMIN`, `AIRLINE_MODERATOR`, `HOTEL_MODERATOR`.
- Account status: `ACTIVE`, `SUSPENDED`, `DEACTIVATED`. Only `ACTIVE` can log in.
- **The global `JwtAuthGuard` checks account status on every authenticated request.** A suspended or deactivated user's existing access cookie gets 401 on any endpoint immediately, not after the token expires (SCRUM-122).
- The authenticated principal (`@CurrentUser()`) is `{ userId, role, airlineId?, hotelId? }`. A moderator has exactly one of `airlineId` / `hotelId`.
- Guards/decorators from `common`: `JwtAuthGuard` (global; use `@Public()` for open routes), `RolesGuard` with `@Roles(Role.ADMIN)`.
- **Ownership is checked in the service, not the controller**: users only touch their own bookings/itineraries/posts/comments/reviews; moderators only their own airline/hotel (compare `airlineId`/`hotelId` from the principal to the resource). Return 404 for another user's private resource, 403 for wrong role. **A moderator editing a different airline or hotel gets 403** (the airline/hotel profile is public, so there is nothing to hide). Use 404 only when the resource itself is private to its owner (bookings, itineraries, drafts, notifications).
- Passwords: min 8 chars, at least one letter and one digit; stored only as salted hashes (bcrypt).

### ACC-07a authentication extension (Ahmed-approved, 2026-11-13)

- User credential state: `mustChangePassword` defaults false; `tokenVersion` defaults zero. Temporary expiration/consumption fields are internal and never part of profile/account responses. Existing records missing the version are version zero.
- New access and refresh JWTs carry `tokenVersion`. Legacy tokens missing that claim mean zero only; null, negative, fractional and nonnumeric versions are invalid. The global guard reads current ACTIVE status/version/forced state on each protected request through `AccountStatusChecker.getAuthenticationState(id)`, provided by UsersService. No cached version or flag is trusted from the client. The principal additionally carries the verified `tokenVersion` for conditional password replacement.
- `POST /api/admin/users/:id/reset-password` is ADMIN-only for ACTIVE USER/AIRLINE_MODERATOR/HOTEL_MODERATOR targets. It generates a temporary password server-side, atomically replaces its salted hash and temporary state, and increments the version, immediately invalidating all older access/refresh tokens at subsequent authorization checks. Role/status/provider associations remain unchanged.
- A temporary password expires 24 hours after generation. Correct login atomically consumes it once before session issuance, matching hash/version/status/expiry/unused state. Wrong passwords do not consume it. If session issuance/delivery fails or the session is lost, another admin reset may be required; consumption is not rolled back.
- While `mustChangePassword` is true, protected routes deny with 403 unless marked `@AllowWhenMustChange()`. Only PATCH `/api/auth/change-password`, GET `/api/auth/me` and logout carry that marker. Existing public routes stay public; logout remains public/idempotent. Refresh verifies version and rejects forced accounts with 401, never extending a forced session or granting unrestricted access.
- Forced replacement reuses the shared password validator, requires a different password, and conditionally matches current hash/version/ACTIVE/consumed state. It clears the flag and temporary markers and increments the version again. Both cookies are cleared; fresh login is required. Ordinary password changes retain their existing current-session behavior while matching the credential version to avoid overwriting a later reset.
- The reset response is the explicitly approved exception for generated plaintext: only ADMIN sees it once with `Cache-Control: no-store`; no email/notification or persisted recovery copy exists. Tokens and hashes remain excluded from all response bodies. Audit logging contains actor/action/target/timestamps only. Audit failure after the credential update returns 500 explaining that credentials changed; there is no unconditional rollback or guarantee of cross-collection atomicity.
- Mohamed implements these cross-module changes under Ahmed's explicit approval; Ziad reviews auth/User integration. Ziad's no-competing-work confirmation remains a final coordination item, not a prohibition on isolated local implementation, per Mohamed's latest instruction. No role/status enum or shared AuditService signature changes are part of this extension.

## 5. Shared enums (in `common/enums`, do not redefine elsewhere)

```ts
Role: USER | ADMIN | AIRLINE_MODERATOR | HOTEL_MODERATOR
AccountStatus: ACTIVE | SUSPENDED | DEACTIVATED
BookingStatus: PENDING_PAYMENT | CONFIRMED | COMPLETED | EXPIRED | CANCELLED
  // only transitions: PENDING_PAYMENT->CONFIRMED->COMPLETED, PENDING_PAYMENT->EXPIRED, CONFIRMED->CANCELLED
BookingType: FLIGHT | HOTEL
FlightStatus: SCHEDULED | CANCELLED | DEPARTED
CabinClass: ECONOMY | PREMIUM_ECONOMY | BUSINESS | FIRST
PassengerType: ADULT | CHILD | INFANT      // 12+, 2-11, <2
PaymentStatus: REQUIRES_PAYMENT | PROCESSING | SUCCEEDED | FAILED | CANCELLED
RefundStatus: PENDING | REFUNDED | FAILED
Visibility: PRIVATE | PUBLIC
PostStatus: DRAFT | PUBLISHED
ContentType: POST | COMMENT | REVIEW | ITINERARY
ReportStatus: OPEN | DISMISSED | HIDDEN | DELETED
NotificationType: BOOKING_CONFIRMED | BOOKING_CANCELLED | REFUND_UPDATE | FLIGHT_SCHEDULE_CHANGED | ACCOUNT_SUSPENDED | ACCOUNT_REACTIVATED | PROVIDER_DEACTIVATED
```

State transitions of `BookingStatus` go through `BookingLifecycle.transition()` (owned by Payments). Nobody sets `status` directly.

**Completion (`CONFIRMED -> COMPLETED`):** hotel bookings are completed after check-out (HTL-23, Hotels B). Flight bookings are completed by Flights A: when a flight is marked `DEPARTED`, it calls `BookingLifecycle.transition(FLIGHT, bookingId, COMPLETED)` for each of that flight's `CONFIRMED` bookings. Cancelled flights never complete; their bookings follow the cancellation path.

## 6. Business constants (in `common/constants.ts`, read from env where noted)

| Constant | Value |
|---|---|
| `HOLD_MINUTES` (env) | 10 (flight seats and hotel rooms) |
| `PAYMENT_PAUSE_MAX_MINUTES` | 5 (longest a payment in flight can pause hold expiry) |
| Login lockout | 5 consecutive failures, 15 minutes, success resets counter |
| Session inactivity | 30 minutes |
| Default page size | 10 |
| Images | JPG/PNG, max 5 MB, max 5 per post/activity/hotel, 1 logo per airline |
| Itinerary | max 60 days, title max 100 chars |
| Blog | comment max 500 chars, max 5 tags (30 chars each), review max 1000 chars |
| Infant fare | 10% of cabin fare, takes no seat; at least 1 adult, infants <= adults |

## 7. Cross-module services (call these, never re-implement)

Everything below is injected via NestJS DI. Owners publish the signature first; consumers code against it and stub until it merges.

| Service | Owner | Signature (stable) | Used by |
|---|---|---|---|
| `NotificationsService.notify` | Payments | `notify({ userId, type, title, message, link? }): Promise<void>` | everyone who tells users something |
| `AuditService.log` | Admin | `log({ actorId, action, targetType, targetId, details? }): Promise<void>` | admin actions, moderation |
| `UploadService.save / remove` | Admin / seeding / uploads (Walid) | `save(file, { kind, ownerId }): Promise<{ id, url }>`, `remove(id)`; enforces JPG/PNG, 5 MB, count limits | airlines, hotels, itineraries, blog |
| `BookingLifecycle.transition` | Payments | `transition(type, bookingId, to: BookingStatus): Promise<void>`; rejects illegal transitions | booking owners |
| `RefundsService.issue` | Payments | `issue({ bookingType, bookingId, amountCents, reason }): Promise<Refund>`; called on every cancellation with a positive refund | flight/hotel cancel, flight cancel by airline |
| `FxService.convert` | Payments (`fx` module) | `convert(amount, from, to): Promise<{ amount, rateDate }>`; rates fetched once per day and cached in the database | itineraries (budget summary) |
| `RefundCalculator.compute` | Payments | `compute({ tiers, daysBefore, totalCents }): number`: tier with highest threshold not above days remaining, else 0 | flight/hotel cancel preview + cancel; reads tiers through the airlines/hotels owners' exported getters |
| Booking provider interface (`BookingProvider`) | Flights B, Hotels B | `getPayable(id, userId)` -> `{ amountCents, currency, status, holdExpiresAt }`, `markConfirmed(id, paymentRef)`, `getPolicies(id)` (there is no `markExpired`: expiry goes through `applyStatus`), plus the lifecycle methods below | Payments (payment, webhook, expiry sweep, policy acceptance) |
| `BookingProvider` lifecycle methods | Flights B, Hotels B | `getStatus(id)` -> `{ status, holdExpiresAt? }`; `applyStatus(id, from, to): Promise<boolean>` (atomic conditional update on `_id` AND `status = from`; `false` if the booking was no longer in `from`); `findExpiredHolds(now, limit, afterId?)` -> overdue `PENDING_PAYMENT` bookings ordered by `_id`, after `afterId` when given | `BookingLifecycle` only |
| `BookingProviderRegistry` | Payments | `register(type, provider)`; owners register their provider on module init so Payments never imports their modules | booking owners (register), `BookingLifecycle` (lookup) |
| `PaymentActivity.prepareExpiry` | Payments | `prepareExpiry(type, bookingId, now): Promise<'SKIP' \| 'PAID' \| 'EXPIRE'>`; `SKIP` = a payment is in flight and inside the pause cap, `PAID` = cancelling the PaymentIntent found it already succeeded (booking must be confirmed, not expired), `EXPIRE` = safe to expire | `BookingLifecycle` (sweep and lazy check) |
| `ReferenceDataService` | Admin | read access to countries, cities, airports, attractions, currencies by ID, plus list queries: airports by city or country, cities by country, countries, attractions by city (`ReferenceDataModule` is imported in `AppModule`) | flights, hotels, itineraries, users |
| `isHidden` flag | field on `Post`, `Comment`, `Review`, `Itinerary` | hidden content is returned only to its author and admins | blog, reviews, itineraries, reports |

Payments owns the **hold-expiry sweep** (cron every minute plus a lazy expiry check whenever a booking is read) for both booking collections. Booking owners only create `PENDING_PAYMENT` bookings with `holdExpiresAt`.

`BookingLifecycle.transition()` is the only code that changes `BookingStatus`. It validates against the transition table, calls `applyStatus`, and the owner's `applyStatus` releases inventory in the same MongoDB transaction when `to` is `EXPIRED` or `CANCELLED` (no separate best-effort release step). Booking owners check that the caller owns the booking BEFORE calling `transition()`. Before expiring, the sweep and the lazy check call `PaymentActivity.prepareExpiry`; the sweep walks overdue bookings by `_id` with `afterId` so skipped bookings are neither re-fetched in a loop nor starve later ones.

**Confirmation rule.** Every path that confirms a paid booking, including `BookingLifecycle.settleDueBooking` when `PaymentActivity.prepareExpiry` returns `PAID`, must call the owner's `markConfirmed(id, paymentRef)` and store `paymentRef`. A bare `transition(..., CONFIRMED)` is not allowed: it skips the reference, the held-to-booked conversion and the notification. `markConfirmed` must be idempotent and callable from both the webhook and the late-paid expiry path.

**Cancellation policy split.** Tier storage, validation and routes (`PUT /api/airlines/:id/cancellation-policy`, `PUT /api/hotels/:id/policies`) live in the airlines and hotels modules and are owned by their module owners. Payments owns `RefundCalculator.compute` and never copies or edits the tier data.

**Flight status job.** The DEPARTED job (FLT-30) lives in the flights module and is owned by Flights A.

## 8. Concurrency rules (flight seats, hotel rooms)

- Never "read, check, then write". Reserve with one atomic conditional update (`findOneAndUpdate` with the availability condition in the filter and `$inc` in the update), or inside a MongoDB transaction.
- Available seats = total - booked - held (held = unexpired holds). Infants take no seat.
- Hotel booking with several rooms is **all or nothing**: use a transaction; if any room overlaps a confirmed booking, an unexpired hold, or a blocked range, hold nothing and return 409.
- Expired/failed payment releases the seats/rooms. Cancellation returns them to inventory.
- **A payment in flight pauses the hold.** A booking whose payment is `PROCESSING` is not expired. The pause ends at the first of: the payment reaches `SUCCEEDED`, `FAILED` or `CANCELLED`, or `PAYMENT_PAUSE_MAX_MINUTES` pass since it entered `PROCESSING`. After the cap, Payments cancels the PaymentIntent first; if Stripe says it already succeeded, the booking is confirmed instead of expired. After `FAILED`/`CANCELLED`, the normal clock applies (an overdue booking is expired by the next sweep).
- A new payment may only start while the booking is `PENDING_PAYMENT` and its hold is unexpired, and only one payment may be in flight per booking. Worst case a hold lasts `HOLD_MINUTES` + `PAYMENT_PAUSE_MAX_MINUTES`.
- Availability queries count only unexpired `PENDING_PAYMENT` and `CONFIRMED` bookings; `EXPIRED` and `CANCELLED` never block inventory.
- If a payment succeeds for a booking that is already `EXPIRED`, Payments refunds it automatically (PAY-03) and notifies the user; it never revives the booking.

## 9. Module interfaces: what each owner provides and needs

| Owner | Provides | Needs from |
|---|---|---|
| Auth (Ziad Mohamed) | Guards, `@CurrentUser`, login/session, profile (incl. preferred currency) | Admin (seed admin) |
| Admin / seeding / uploads (Mohamed Walid) | Seeding + `ReferenceDataService` (incl. list queries), `UploadService`, audit log, moderator creation, suspend/reactivate, provider deactivate/reactivate (`PATCH /api/admin/providers/:type/:id/deactivate` and `/reactivate`, `:type` = `hotel` or `airline`; separate from suspending the moderator; hidden from search and not bookable, existing CONFIRMED bookings stay valid; affected parties notified), reports | Auth (guards), airlines/hotels exist (moderator link), Notifications |
| Flights A (Ahmed Sanad) | Skeleton, `common/`, airlines, flights, cabins, baggage rules, airline cancellation tiers, flight status job | Seeding (airports/cities), Upload |
| Hotels A (Yusuf Eser) | Hotels, rooms, availability, hotel policies (check-in/out times, cancellation tiers) | Seeding (cities), Upload |
| Flights B (Abdulrahman Hosny) | Search, holds, flight booking, e-ticket, cancel | Flights A (cabins), Payments (confirm/refund), Notifications |
| Hotels B (Hessain Elrefaey) | Search, holds, hotel booking, cancel, reviews, reservations list for the hotel moderator (HTL-22) | Hotels A (rooms/availability), Payments, Notifications |
| Payments (Abdelrahman ElGabarty) | Stripe, webhook, refunds, notifications, lifecycle, `RefundCalculator`, FX (`fx` module) | Booking provider interface |
| Itineraries (Yassin) | Itineraries, days, budgets, clone | Seeding (cities/currencies), Upload, Payments (`FxService`), Hotels B / Flights B search |
| Blog (Yusuf Eser) | Posts, comments, likes, tags, search | Auth (guards), Upload |

## 10. Rules for the AI assistant

1. Work on **one ticket at a time**, the one the student pasted. Do not add features beyond its requirement IDs.
2. Only create or edit files in the student's own module. Never edit another module or `common/`. If something is needed there, write a short message for the student to send to the owner (what, why, which signature) and code against the signature in section 7 with a stub.
3. Always use the shared enums, error shape, pagination, guards, money and date rules and cross-module services above. Never redefine them.
4. Put business rules and ownership checks in services, not only in DTOs or controllers.
5. Give the student, with the code: the Swagger endpoints, plus a test list (happy path, validation error, wrong role, other user's resource, concurrency case if relevant) to run before the PR.
6. Explain each non-trivial part briefly. The student must be able to explain every line to their instructors.
7. End every answer with a ready-to-paste `AI_PROMPTS.txt` entry (date, tool, requirement ID, prompt summary, how the output was used).
8. Never ask for or use secrets, `.env` content, or real personal data.
9. **Definition of done.** Every Jira ticket has a "Checklist (all checked before the PR is opened)" section. Before you tell the student the code is ready for a PR, go through that checklist item by item and state for each item how the code satisfies it (or what is still missing). Do not suggest opening the PR while any item, or any item of `.github/pull_request_template.md`, is unchecked. The PR check fails if a `- [ ]` is left in the PR description.

## 11. Reviewer checklist (what the Reviewer AI will check)

1. **Requirement match**: every acceptance criterion in the ticket's requirement ID is implemented; nothing extra or missing.
2. **Contract match**: enums, error shape, pagination, money (`...Cents`), dates (UTC), IDs, service signatures exactly as in this file.
3. **Auth**: correct guard and role on every endpoint; ownership checks in the service; no tokens in bodies or storage; 404/403 used correctly.
4. **Validation**: DTO rules plus business rules in the service (dates, limits, duplicates, status checks).
5. **Concurrency**: atomic updates or transactions, no read-then-write; holds expire and release.
6. **Cross-module safety**: only calls the shared services; touches nothing outside the module; breaking changes to other people's modules flagged.
7. **Data model**: sensible schema, references vs embedding, indexes, no secrets or card data stored.
8. **API quality**: RESTful names, correct status codes, Swagger complete, lists paginated.
9. **Hygiene**: commit messages, PR title with requirement ID, no `.env`/secrets/dead code/console logs, `AI_PROMPTS.txt` updated.
10. **Evidence**: PR description lists the Swagger tests done (including failure cases).

Reviewer verdict format: `APPROVE`, `CHANGES REQUESTED` (numbered blocking issues with file/line and fix), or `QUESTIONS`, plus a short list of non-blocking suggestions.
