# Auth: refresh-token rotation and logout (ACC-06, issue #115)

There was no separate ACC-06 doc in the repo, so this page is the reference for how refresh and logout behave.

## Behaviour

- `POST /api/auth/refresh` **rotates** the refresh token. The cookie you send is consumed (single use) and the
  response sets a new `access_token` and a new `refresh_token`. Only the newest refresh cookie works.
- Replaying an already used refresh cookie returns `401 "Invalid or expired session"` (same generic message and the
  same cleared cookies as every other refresh failure). The newest session is **not** affected by a rejected replay.
- Two refreshes with the same cookie at the same moment: exactly one gets `200`, the others get `401`.
- A refresh that is rejected for another reason (bad signature, expired, suspended or deactivated user, outdated
  `tokenVersion`, password change pending) does **not** consume the token.
- `POST /api/auth/logout` revokes the refresh token in the cookie. Earlier cookies of that session were already
  consumed by their refresh, so after login, refresh and logout, no earlier refresh cookie works.
- How it is stored: the `revokedTokens` collection holds only the token's `jti`, the user id and the token expiry.
  A consumed token and a logged-out token are the same kind of row. A TTL index removes the row when the token would
  have expired anyway. The unique index on `jti` makes the consume step atomic.

## Known limits

- The **access token stays valid for up to 15 minutes after logout** (it is stateless and not checked against the
  list). This is accepted. Account suspension, deactivation and password reset still cut it off immediately because
  the global guard re-reads the account on every request.
- A refresh token issued before this change works once (it is consumed on its first use), then follows the new rules.
- No reuse detection: replaying a used token only returns 401. It does not log the user out everywhere.

## Frontend note

If two tabs refresh at the same moment with the same cookie, one of them gets `401`. Treat a `401` from
`/api/auth/refresh` as "log in again", or serialize refreshes (one in flight at a time, shared by all tabs/requests).
