# Email-based forgotten password (ACC-07, SCRUM-111, bonus)

Owner: Ziad Mohamed (auth). `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`. Both are `@Public()`.

## Flow

1. The user enters their email. The frontend calls `POST /api/auth/forgot-password`.
2. If the email belongs to an `ACTIVE` account, the server emails a link. The link works **once** and expires **30 minutes** after the request.
3. The user opens the link. The frontend reads the `token` query parameter and sends it with the new password to `POST /api/auth/reset-password`.
4. On success the user logs in with the new password. Nothing is logged in automatically and no cookie is set.

## `POST /api/auth/forgot-password`

```http
POST /api/auth/forgot-password
Content-Type: application/json

{ "email": "ali@example.com" }
```

The email is trimmed and lower-cased, like login.

| Status | When | Body |
|---|---|---|
| 200 | Any well-formed email: known, unknown, suspended, deactivated, locked | `{ "message": "If the email is registered, a reset link has been sent." }` |
| 400 | Malformed or missing email, or an unknown field | Standard shape, `details: [{ "field": "email", "message": "email must be valid" }]` |

The response never reveals whether the email exists:

- The same status and body for every case. Only an `ACTIVE` account is emailed; unknown, `SUSPENDED` and `DEACTIVATED` accounts get nothing.
- The lookup and the sending happen **after** the response is decided, so response time does not depend on the account or on the mail server.
- A failed send changes nothing in the response. It is logged on the server with the user id only (never the token, the link or the address).
- A locked account (ACC-05) can still request a link.

A newer request **invalidates every older link** of that user (one row per user is overwritten atomically, so two parallel requests also leave exactly one live link). Each request sends its own email; only the link in the latest one works.

## The link the frontend must handle

```
{FRONTEND_URL}/reset-password?token=<token>
```

- `FRONTEND_URL` is a backend environment variable (default `http://localhost:3000`, see `.env.example`).
- The frontend needs a page at **`/reset-password`** that reads the query parameter named **`token`**.
- The token is 43 URL-safe characters (`A-Z a-z 0-9 - _`). Send it back unchanged.
- The server stores only a SHA-256 hash of the token; a lost link cannot be recovered, request a new one.

## `POST /api/auth/reset-password`

```http
POST /api/auth/reset-password
Content-Type: application/json

{ "token": "<token from the link>", "newPassword": "N3wPassw0rd" }
```

`newPassword` follows the platform rule: at least 8 characters, a letter and a digit, at most 72 bytes.

| Status | When | Notes |
|---|---|---|
| 204 | Password replaced | Empty body, no cookies |
| 400 | `newPassword` breaks the rules, or the body is malformed | `details: [{ "field": "newPassword", ... }]`. The token is **not** consumed, so the user can try again with the same link. |
| 400 | The token is unknown, expired, already used, replaced by a newer request, or its account is no longer `ACTIVE` | `details: [{ "field": "token", "message": "token is invalid or has expired" }]`. One message for all reasons, so nothing leaks. |

Order of checks: the body is validated first (weak password), then the token.

On success:

- The token is consumed by a single atomic compare-and-set; of several parallel requests with the same token exactly one gets 204 and the others get the token 400.
- The new password is stored only as a salted bcrypt hash (cost 10), the same helper as change-password.
- All existing sessions die: the credential version is incremented, so old access and refresh cookies get 401.
- The login lockout (ACC-05) is cleared (`failedAttempts` 0, no `lockedUntil`), and any pending admin temporary password (ACC-07a) is cleared.

## Development without SMTP

Without `SMTP_HOST` (the normal local setup) the server sends through a throwaway Ethereal test inbox and logs a line such as `Email preview (test inbox): https://ethereal.email/message/...`. Open that URL to read the email and copy the link. With `NODE_ENV=production` and no `SMTP_HOST` the send fails (and is logged), so configure SMTP there. See GEN-01-B.

## Not included

Rate limiting per email or IP is not part of this ticket (see the PR notes).
