# Email verification before booking (ACC-02, bonus)

A new account must confirm its email address before it can create a booking.

## The rule

- `User.emailVerified` is a boolean. **Only an explicit `false` means unverified.** New registrations are saved with `false`.
- A user without the field (existing accounts, seeded accounts, moderators created by an admin, test fixtures) counts as **verified**, so nothing else changes behaviour.
- Login is **not** blocked for an unverified user. Only the routes that carry `@RequireVerifiedEmail()` are blocked.
- `GET /api/auth/me`, the register and login responses include `emailVerified` (`false` until verified; `true` for verified and field-less accounts).

## The link

- After `POST /api/auth/register` (response unchanged, still 201) the API emails a link in the background. A failed send is logged (user id only) and never fails registration.
- Link: `{PUBLIC_API_URL}/api/auth/verify-email?token=<token>`. `PUBLIC_API_URL` is optional (default `http://localhost:3001`); see `.env.example`.
- The token is 32 random bytes (base64url). Only its SHA-256 hash is stored, in `emailVerificationTokens` (one row per user, TTL index on `expiresAt`). Valid for **24 hours**. Single use.

## `GET /api/auth/verify-email?token=...` (public)

| Case | Response |
|---|---|
| Valid token | `200 { "message": "Email verified" }` |
| Valid token, user already verified | `200 { "message": "Email already verified" }` |
| `token` missing | `400`, `details: [{ field: "token", message: "token is required" }]` |
| Unknown, expired, already used, or the account is not ACTIVE | `400`, `details: [{ field: "token", message: "invalid or expired verification link" }]` (same answer for all) |

The token is consumed with one atomic delete, so of several parallel requests with the same token exactly one gets 200.
There is no resend endpoint yet (see follow-ups in the PR).

## The guard (for booking owners)

```ts
import { RequireVerifiedEmail } from '../auth';   // 1. import

@Post()
@Roles(Role.USER)
@RequireVerifiedEmail()                            // 2. add this one line
create(...) { ... }
```

No module imports or providers are needed. An unverified user gets `403`:

```json
{ "statusCode": 403, "error": "Forbidden", "message": "Verify your email before booking",
  "details": [ { "field": "emailVerified", "message": "EMAIL_NOT_VERIFIED" } ], "path": "...", "timestamp": "..." }
```

A guest still gets 401 first (global guard). Admins and moderators are not affected (no `emailVerified: false` on their records).
The decorator also adds the 403 to Swagger.

## Routes that should add `@RequireVerifiedEmail()`

| Route | Owner |
|---|---|
| `POST /api/flight-bookings` | Abdulrahman |
| `POST /api/flight-bookings/hold` | Abdulrahman |
| `POST /api/hotel-bookings` | Hessain |
| `POST /api/payments` | Abdelrahman |

Other routes checked, not needing it: `POST /api/payments/:id/retry` (the booking already exists, so it was created by a verified user),
`POST /api/bookings/:type/:id/accept-policies` (same), itinerary item routes (planning data, not bookings). Cancel and read routes stay open.
