# Guest restricted actions return 401 (ACC-10)

Every endpoint needs a logged-in user unless its controller marks it `@Public()`. A guest (no cookie, or an
invalid, expired or tampered `access_token`, or a suspended/deactivated account) who calls a protected endpoint
gets the standard error body:

```json
{ "statusCode": 401, "error": "Unauthorized", "message": "Authentication required",
  "path": "/api/itineraries", "timestamp": "2026-11-06T10:00:00.000Z" }
```

For the frontend (return-to-action flow, M2):

- On **any** 401 from a restricted action (book, review, post, ...), remember the action and redirect to login;
  after login, send the user back to it.
- Key on the **status code only**. `message` varies ("Authentication required", "Invalid or expired token") and
  is not a stable contract.
- A 403 means logged in but wrong role. It is not a reason to redirect to login.
- Which routes are open to guests is decided per endpoint with `@Public()` (for example register, login,
  refresh, airport lookup, flight search). Do not hard-code a list.
- `POST /api/auth/refresh` is `@Public()` and answers 401 itself when the refresh cookie is missing or dead.
  Treat that 401 as "session over, go to login" too.

`backend/test/guest-401.e2e-spec.ts` proves this for every route of the app, including routes added later.
