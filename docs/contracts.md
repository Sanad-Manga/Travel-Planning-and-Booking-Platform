# Project Contracts (v1.1)

**Instructions to the AI assistant reading this:** you are helping one student implement one ticket of a team NestJS + MongoDB project. This file is the team's binding contract. Follow it exactly. If your code would conflict with it, the file wins. If the file seems wrong or incomplete for the ticket, stop and tell the student to raise it with the lead; do not work around it or invent your own version. If the ticket or any needed signature is missing, ask for it before writing code. Before coding, list your assumptions and anything you need from another module. A separate Reviewer AI will check the student's PR against this file and the ticket, using the checklist in section 11, so self-check your output against it.

---

## 1. Stack and layout

- Backend: NestJS + TypeScript + MongoDB Atlas (Mongoose). Frontend: Next.js (later).
- Folders: `backend/`, `frontend/`, `docs/requirements`, `docs/api`, `AI_PROMPTS.txt`, `README.md`, `.env.example`.
- One folder per feature module: `backend/src/<module>/` with `<module>.module.ts`, `.controller.ts`, `.service.ts`, `schemas/`, `dto/`.
- Modules: `auth`, `users`, `admin`, `airlines`, `flights`, `flight-bookings`, `hotels`, `hotel-bookings`, `reviews`, `payments`, `refunds`, `notifications`, `uploads`, `audit`, `itineraries`, `blog`, `reports`, `reference-data`, `common`.
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
- The authenticated principal (`@CurrentUser()`) is `{ userId, role, airlineId?, hotelId? }`. A moderator has exactly one of `airlineId` / `hotelId`.
- Guards/decorators from `common`: `JwtAuthGuard` (global; use `@Public()` for open routes), `RolesGuard` with `@Roles(Role.ADMIN)`.
- **Ownership is checked in the service, not the controller**: users only touch their own bookings/itineraries/posts/comments/reviews; moderators only their own airline/hotel (compare `airlineId`/`hotelId` from the principal to the resource). Return 404 for another user's private resource, 403 for wrong role.
- Passwords: min 8 chars, at least one letter and one digit; stored only as salted hashes (bcrypt).

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
NotificationType: BOOKING_CONFIRMED | BOOKING_CANCELLED | REFUND_UPDATE | FLIGHT_SCHEDULE_CHANGED | ACCOUNT_SUSPENDED | PROVIDER_DEACTIVATED
```

State transitions of `BookingStatus` go through `BookingLifecycle.transition()` (owned by Payments). Nobody sets `status` directly.

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
| `UploadService.save / remove` | Blog | `save(file, { kind, ownerId }): Promise<{ id, url }>`, `remove(id)`; enforces JPG/PNG, 5 MB, count limits | airlines, hotels, itineraries, blog |
| `BookingLifecycle.transition` | Payments | `transition(type, bookingId, to: BookingStatus): Promise<void>`; rejects illegal transitions | booking owners |
| `RefundsService.issue` | Payments | `issue({ bookingType, bookingId, amountCents, reason }): Promise<Refund>`; called on every cancellation with a positive refund | flight/hotel cancel, flight cancel by airline |
| `RefundCalculator.compute` | Payments | `compute({ tiers, daysBefore, totalCents }): number`: tier with highest threshold not above days remaining, else 0 | flight/hotel cancel preview + cancel |
| Booking provider interface (`BookingProvider`) | Flights B, Hotels B | `getPayable(id, userId)` -> `{ amountCents, currency, status, holdExpiresAt }`, `markConfirmed(id, paymentRef)`, `markExpired(id)`, `getPolicies(id)`, plus the lifecycle methods below | Payments (payment, webhook, expiry sweep, policy acceptance) |
| `BookingProvider` lifecycle methods | Flights B, Hotels B | `getStatus(id)` -> `{ status, holdExpiresAt? }`; `applyStatus(id, from, to): Promise<boolean>` (atomic conditional update on `_id` AND `status = from`; `false` if the booking was no longer in `from`); `findExpiredHolds(now, limit, afterId?)` -> overdue `PENDING_PAYMENT` bookings ordered by `_id`, after `afterId` when given | `BookingLifecycle` only |
| `BookingProviderRegistry` | Payments | `register(type, provider)`; owners register their provider on module init so Payments never imports their modules | booking owners (register), `BookingLifecycle` (lookup) |
| `PaymentActivity.prepareExpiry` | Payments | `prepareExpiry(type, bookingId, now): Promise<'SKIP' \| 'PAID' \| 'EXPIRE'>`; `SKIP` = a payment is in flight and inside the pause cap, `PAID` = cancelling the PaymentIntent found it already succeeded (booking must be confirmed, not expired), `EXPIRE` = safe to expire | `BookingLifecycle` (sweep and lazy check) |
| `ReferenceDataService` | Admin | read access to countries, cities, airports, attractions, currencies by ID | flights, hotels, itineraries, users |
| `isHidden` flag | field on `Post`, `Comment`, `Review`, `Itinerary` | hidden content is returned only to its author and admins | blog, reviews, itineraries, reports |

Payments owns the **hold-expiry sweep** (cron every minute plus a lazy expiry check whenever a booking is read) for both booking collections. Booking owners only create `PENDING_PAYMENT` bookings with `holdExpiresAt`.

`BookingLifecycle.transition()` is the only code that changes `BookingStatus`. It validates against the transition table, calls `applyStatus`, and the owner's `applyStatus` releases inventory in the same MongoDB transaction when `to` is `EXPIRED` or `CANCELLED` (no separate best-effort release step). Booking owners check that the caller owns the booking BEFORE calling `transition()`. Before expiring, the sweep and the lazy check call `PaymentActivity.prepareExpiry`; the sweep walks overdue bookings by `_id` with `afterId` so skipped bookings are neither re-fetched in a loop nor starve later ones.

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
| Auth | Guards, `@CurrentUser`, login/session, profile (incl. preferred currency) | Admin (seed admin) |
| Admin | Seeding + `ReferenceDataService`, audit log, moderator creation, suspend/reactivate, provider deactivate/reactivate (`PATCH /api/admin/providers/:type/:id/deactivate` and `/reactivate`, `:type` = `hotel` or `airline`; separate from suspending the moderator; hidden from search and not bookable, existing CONFIRMED bookings stay valid; affected parties notified), reports | Auth (guards), airlines/hotels exist (moderator link), Notifications |
| You (lead) | Skeleton, `common/`, airlines, flights, cabins, baggage rules, hotels, rooms, availability | Seeding (airports/cities), Upload |
| Flights B | Search, holds, flight booking, e-ticket, cancel | Flights A (cabins), Payments (confirm/refund), Notifications |
| Hotels B | Search, holds, hotel booking, cancel, reviews | Hotels A (rooms/availability), Payments, Notifications |
| Payments | Stripe, webhook, refunds, notifications, lifecycle, cancellation-tier calc | Booking provider interface |
| Itineraries | Itineraries, days, budgets, FX, clone | Seeding (cities/currencies), Upload, Hotels B / Flights B search |
| Blog | Posts, comments, likes, tags, search, Upload service | Auth (guards) |

## 10. Rules for the AI assistant

1. Work on **one ticket at a time**, the one the student pasted. Do not add features beyond its requirement IDs.
2. Only create or edit files in the student's own module. Never edit another module or `common/`. If something is needed there, write a short message for the student to send to the owner (what, why, which signature) and code against the signature in section 7 with a stub.
3. Always use the shared enums, error shape, pagination, guards, money and date rules and cross-module services above. Never redefine them.
4. Put business rules and ownership checks in services, not only in DTOs or controllers.
5. Give the student, with the code: the Swagger endpoints, plus a test list (happy path, validation error, wrong role, other user's resource, concurrency case if relevant) to run before the PR.
6. Explain each non-trivial part briefly. The student must be able to explain every line to their instructors.
7. End every answer with a ready-to-paste `AI_PROMPTS.txt` entry (date, tool, requirement ID, prompt summary, how the output was used).
8. Never ask for or use secrets, `.env` content, or real personal data.

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
