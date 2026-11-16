# Admin creates moderator accounts (ACC-13, SCRUM-75)

Owner: Ziad Mohamed (implemented in the admin module). `POST /api/admin/moderators`, ADMIN only.

An administrator creates an airline or hotel moderator. The moderator is linked to **exactly one** existing airline
or hotel, so the principal (`@CurrentUser()`) carries `airlineId` or `hotelId` after login (contracts section 4) and
every moderator-only endpoint of the airlines and hotels modules can be used and tested.

## Request

```http
POST /api/admin/moderators
Cookie: access_token=...
Content-Type: application/json

{
  "name": "Hala Hotel",
  "email": "hala.hotel@example.com",
  "role": "HOTEL_MODERATOR",
  "temporaryPassword": "Temp0rary9Pass",
  "hotelId": "6730a1f2c3d4e5f607182932"
}
```

| Field | Rules |
|---|---|
| `name` | Same as registration: trimmed, not empty, max 100 characters |
| `email` | Same as registration: trimmed and lower-cased, valid e-mail, max 254 characters |
| `role` | `AIRLINE_MODERATOR` or `HOTEL_MODERATOR`. `USER` and `ADMIN` are a 400 |
| `temporaryPassword` | The shared password rule: 8+ characters, a letter, a digit, at most 72 bytes |
| `airlineId` | Required for `AIRLINE_MODERATOR`, forbidden for `HOTEL_MODERATOR`. Valid ObjectId of an existing airline |
| `hotelId` | Required for `HOTEL_MODERATOR`, forbidden for `AIRLINE_MODERATOR`. Valid ObjectId of an existing hotel |

Any other field (for example `status` or `passwordHash`) is a 400.

## Responses

| Status | When | Notes |
|---|---|---|
| 201 | Created | The account shape of `GET /api/admin/accounts`: `{ id, name, email, role, status: "ACTIVE", createdAt }`. No password, hash or temporary-password field |
| 400 | Invalid body, role not a moderator role, weak password, or the ids do not match the role (both, neither, or the wrong kind) | Standard shape, one `details` entry per field. A missing or extra provider id names `airlineId` / `hotelId` |
| 401 | Not logged in | |
| 403 | Caller is not an `ADMIN` (USER and both moderator roles) | Nothing is created |
| 404 | The airline or hotel does not exist | `details: [{ "field": "airlineId" \| "hotelId", ... }]`. Admin routes answer 404 for an unknown id |
| 409 | Email already registered (any letter case), including two simultaneous requests with the same email | `details: [{ "field": "email", "message": "email already exists" }]`. Exactly one of the simultaneous requests wins: the unique email index decides, there is no check-then-insert |
| 500 | The insert or the audit write failed | Sanitized message. After an audit failure the account already exists: do not create it again |

Examples of 400 details: hotel moderator sent with an airline id only gives
`[{ "field": "airlineId", "message": "airlineId must not be set for HOTEL_MODERATOR" }, { "field": "hotelId", "message": "hotelId is required for HOTEL_MODERATOR" }]`.

## Temporary password

The admin chooses the password. It is hashed with bcrypt (the shared 10 salt rounds) before anything is stored; the
plaintext is never stored, logged, returned or written to the audit log. The account reuses the ACC-07a
temporary-password state, so the rules are identical to an administrator reset:

- `mustChangePassword = true`, `temporaryPasswordConsumed = false`, `temporaryPasswordExpiresAt` = creation + 24 hours.
- The password works for **one** successful login, before the 24 hours end.
- That session may only call `GET /api/auth/me`, `PATCH /api/auth/change-password` and `POST /api/auth/logout`.
  Every other endpoint answers 403 `Password replacement required` and `POST /api/auth/refresh` answers 401.
- A successful `PATCH /api/auth/change-password` (the new password must differ from the temporary one) clears the
  markers, ends that session and clears the cookies. The moderator then logs in again with the new password and gets a normal session.
- `consentAcceptedAt` is set at creation because the User schema requires it (the admin seeder does the same). It is a
  schema marker, **not** the moderator's consent to anything.

**If the moderator does not log in within 24 hours** (or loses the first session before changing the password), the
temporary password no longer works and the login answers 401. Recovery is the existing
`POST /api/admin/users/:id/reset-password`, which issues a new temporary password. No e-mail or notification is sent:
the admin hands the temporary password to the moderator.

## How the moderator signs in

1. `POST /api/auth/login` with the e-mail and the temporary password: 200 with the cookies and `mustChangePassword: true`.
2. `PATCH /api/auth/change-password` with `{ "currentPassword": "<temporary>", "newPassword": "<new>" }`: 204, cookies cleared.
3. `POST /api/auth/login` with the new password: normal session whose principal carries `airlineId` or `hotelId`.

## Audit

One entry per creation through `AuditService.log`: `action: "MODERATOR_CREATED"`, `targetType: "User"`, `targetId` = the new
account id, `actorId` = the admin, `details: { role, airlineId | hotelId }`. Never the password or hash.

## Decisions the lead should confirm

- An **inactive** (deactivated) airline or hotel may still be linked: it only has to exist.
- Several moderators may be linked to the same airline or hotel; one moderator is linked to exactly one provider.
- An unknown provider id is a 404 (not a 400), consistent with the other admin routes.
- Provider existence is checked through `AirlinesService.exists` and `HotelsService.getPolicies` (HotelsService has no `exists`;
  a small `exists(id)` there would be cleaner, owner: Yusuf).
- The response keeps the ACC-14 account shape and therefore does not include `airlineId` / `hotelId`.

## Known limits (not part of ACC-13)

No e-mail or notification to the new moderator, no list/edit/remove of moderators, no moving a moderator to another
provider, no admin-generated random password option, and the insert and the audit write are not one transaction.
