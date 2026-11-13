# Seeded administrator — ACC-18 / SCRUM-20

This standalone setup command provisions an administrator in the existing `users`
collection using the shared User schema and authentication system. It adds no
HTTP endpoints, administrator collection, runtime module registration or startup
hooks. There is no administrator self-registration.

## Configuration and explicit execution

After reviewing the implementation, manually configure these variables in your
local `backend/.env`. Their names are also listed with empty values in the root
`.env.example`; no credentials are supplied by this repository:

| Variable | Requirement |
| --- | --- |
| `ADMIN_SEED_EMAIL` | Required valid email, at most 254 characters; trimmed and lowercased like registration |
| `ADMIN_SEED_PASSWORD` | Required; at least 8 characters, including a Unicode letter and a digit; at most 72 UTF-8 bytes |
| `ADMIN_SEED_NAME` | Required nonblank display name, trimmed, at most 100 characters |
| `MONGODB_URI` | Explicit database connection for the intended operation; no fallback URI |

Password whitespace is preserved. Credential validation reuses the existing
RegisterDto rules, including bcrypt's byte limit, without pretending that the
administrator submitted a registration form or setting `acceptTerms=true`.
Both credentials and the URI are validated before creating a database connection.
No default password or account is supplied.

From `backend/`, on Node 22 or newer:

```powershell
npm run seed:admin
```

`preseed:admin` runs `npm run build`; only after a successful build does
`seed:admin` run `node --env-file=.env dist/admin/seed/seed-admin.js`. This command
is independent of GEN-12's seed scripts, does not run during installation or app
startup, and does not bootstrap AppModule. The env file must exist for this npm
command. Explicit process variables take precedence over the file. Never supply
credentials as command-line arguments.

The compiled CLI can alternatively run after a build with environment variables
already supplied explicitly:

```powershell
node dist/admin/seed/seed-admin.js
```

The shared User/schema imports follow the project's existing dotenv convention;
process variables still take precedence. The CLI outputs only a fixed success,
already-exists, invalid-configuration or sanitized database-failure message. It
never prints email/password values, hashes, tokens or connection strings. Failure
exits with code 1; success and safe reruns exit with code 0.

Do not execute against the shared team database as part of development/testing.
Actual provisioning is an explicit later operator action after review. To verify
it safely, use the isolated automated tests below and log in through the existing
auth endpoint in an approved environment; never dump a users collection or hashes
to prove success.

## Creation, reconciliation and concurrency

New accounts receive `Role.ADMIN`, `AccountStatus.ACTIVE`, the configured identity,
and a salted bcrypt hash using the existing `BCRYPT_SALT_ROUNDS` constant (10).
The shared schema supplies other defaults, including preferred currency.

`consentAcceptedAt` is required by the existing User schema. For a seeded account,
it is populated with the system provisioning time, equal to its initial timestamps.
This is a schema-compatibility marker for provisioning, **not evidence that a human
accepted terms through public registration**. The existing field/schema/auth code
is not changed; callers must not treat this seeded timestamp as interactive consent.

| Database state | Behavior |
| --- | --- |
| No account with the normalized email | Create one ACTIVE ADMIN |
| Existing ADMIN | Return already-exists; preserve password/hash, name, role, status, preferences and all timestamps |
| Existing USER or moderator with that email | Refuse with a sanitized collision error; never promote, reset or overwrite the account |
| Other accounts | Leave them unchanged |

Changing the env password/name does not rotate or rename an existing administrator.
Reruns do not reactivate suspended/deactivated accounts. Use a separate intended
administrator email when an ordinary account already owns the configured email.

The seeder creates the User schema's declared indexes without dropping existing
ones. An initial role-only lookup avoids unnecessary hashing for existing accounts;
it is not the uniqueness mechanism. Creation uses an atomic email-keyed upsert
with `$setOnInsert` and the unique email index. Timestamp updates are disabled for
matched records. Racing insert winners are checked again: an ordinary account is
never promoted, including when it appears after the initial empty lookup. Duplicate
key races are resolved by reading that winner; other database errors fail safely.
No users are deleted and no transaction or collection reset is introduced.

## Existing login, registration and Swagger

Administrators use **POST `/api/auth/login`**, then GET `/api/auth/me`, exactly like
other accounts. Existing status checks and cookie handling remain active: tokens
are carried in httpOnly cookies, Secure when configured, with the existing SameSite
and path policies. Response DTOs expose neither tokens nor password hashes.

POST `/api/auth/register` remains USER-only. The shared validation pipe rejects
`role: ADMIN` (and lowercase `admin`) as an unknown field with the standard 400
error shape. There is no administrator creation/login API. No auth implementation,
registration DTO, token code, guard or shared User schema was modified.

Swagger remains at `/api/docs` (JSON: `/api/docs-json`). The existing login and
registration paths/response schemas are verified; RegisterDto has no role option.
No teammate-owned Swagger change is necessary for this CLI-only ticket.

## Tests and review checklist

Run from `backend/` in an environment without real credentials:

```powershell
npm test -- --runInBand src/admin/seed
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build
npm run lint
```

The config tests reuse the exact registration limits and check missing/invalid
credentials, normalization, Unicode/ASCII byte boundaries and sanitized failures.
The integration tests use the existing real-auth test helper and its own
MongoMemoryServer: hashing, required fields, repeat/concurrent seeding, non-admin
collisions (including a deliberately raced normal-user insert), unrelated accounts,
public-registration rejection, successful/failed login, ADMIN identity, cookies,
status checks and Swagger are exercised without mocks of auth behavior.

The CLI tests create an isolated temporary source/config copy, link already
installed dependencies and write only synthetic `.env` values pointing to their
own generated database URI. They start with no dist output, run the real npm
command twice, compare the unchanged account and verify sanitized nonzero failures.
They never copy/read the developer's real `.env`, connect to Atlas or install
packages. All destructive fixture cleanup targets disposable databases/directories.

The live [SCRUM-20 ticket](https://ahmedsanadprojects.atlassian.net/browse/SCRUM-20)
and contracts v1.3 were checked before implementation. No official university
requirements workbook or project-description file was found in the repository;
their exact contents are not claimed verified. Jira prose mentions documenting dev
credentials, but its checklist and the task explicitly prohibit values: only
variable names and configuration instructions are documented here.

Scope for the eventual PR: administrator seed code/tests/docs, the two explicitly
authorized package scripts, public `.env.example`, the root README link and the AI
log. Auth/users/common, existing reference-data seeding, APIs, schemas, dependencies
and lockfile are unchanged. The eventual PR must name ACC-18 and identify these
shared documentation/script changes; publication/checklist updates require the
student's later authorization. This task creates no PR or Jira update.

## Final verification and acceptance — 2026-11-06

Before implementation, `feature/ACC-18-admin-seed` was clean and matched the locally
recorded develop/origin-develop baseline `fbedaeb` (no branch operations or fetch).
Verification ran in an environment-free temporary backend copy with existing
dependencies; no packages were installed.

| Verification | Observed result |
| --- | --- |
| New administrator tests | PASS: 16 configuration unit tests, 14 database/auth tests, 3 CLI tests |
| Full `npm test -- --runInBand` | PASS: 386 tests across 28 suites |
| Full `npm run test:e2e -- --runInBand` | PASS: 201 tests across 11 suites |
| `npm run build` | PASS; the npm CLI tests also built from missing output |
| `npm run lint` | PASS |
| `npm run seed:admin` | PASS twice in the isolated CLI fixture, using only synthetic env values |

The extra deterministic normal-user race fixture initially hit a TypeScript
overload mismatch in its test adapter. It was corrected and verified before the
final all-passing Jest run; no auth/User/production seed change was needed.

| SCRUM-20 / task acceptance item | Status and evidence |
| --- | --- |
| Administrator created through setup seeding only | PASS: standalone explicit CLI; User creation integration test; no runtime module hook |
| Credentials exclusively from environment variables | PASS: required ADMIN_SEED variables; synthetic env-file CLI test; no fallback values |
| Password securely hashed | PASS: shared cost-10 bcrypt convention; stored hash differs from input and compares correctly |
| Repeated seeding does not duplicate administrators | PASS: same normalized email, unchanged account/hash/timestamps and one document on rerun |
| Ordinary users cannot be silently promoted | PASS: USER/moderator collisions and a normal-user winner inserted after the initial lookup remain unchanged |
| Public admin self-registration impossible | PASS: existing USER-only registration preserved; no administrator route added |
| Registration specifying ADMIN rejected | PASS: uppercase/lowercase attempts return the shared 400 error and create no account |
| Seeded admin logs in through existing login | PASS: HTTP 200, ADMIN response/token identity and authenticated /auth/me; incorrect/missing credentials rejected |
| Required .env.example names without real credentials | PASS: ADMIN_SEED_EMAIL, ADMIN_SEED_PASSWORD and ADMIN_SEED_NAME have empty values |
| Swagger requirement | PASS: real auth Swagger paths/responses verified; RegisterDto has no role option; no owner changes needed |
| README updated | PASS: setup, environment names, provisioned timestamp semantics, login and collision/idempotency behavior documented |
| No new HTTP endpoints | PASS: no controller or module registration added; administrator creation path returns 404 |
| Existing authentication preserved | PASS: no auth/users/common changes; status and secure-cookie tests plus full auth/E2E regressions pass |
| Tests, build and lint pass | PASS: observed results above |
| AI_PROMPTS.txt updated | PASS: ACC-18 implementation/verification entry appended, preserving prior entries |
| Applicable team contracts | PASS: existing schema/enums/hash/validation/auth conventions; unique-index atomic creation; no secrets or unrelated module edits |
| PR template can be completed | PASS for code/evidence: every applicable technical item is covered below; actual publication/title/checkbox editing is left to the student |

Live Jira's four checklist items are covered explicitly: (1) seed and safe rerun,
(2) env-only credentials and blank public variable declarations, (3) rejected role
registration, and (4) verified Swagger plus this README. Proposed eventual title:
`feat(admin): seed administrator account (ACC-18)`. No PR or Jira checklist was edited.

PR-template evidence: ACC-18/SCRUM-20 scope and affected owners are listed above;
the matrix walks through acceptance; shared schema/enums/validation/cookies are
reused; auth/ownership is setup-only with no new route; credential validation and
collision checks are in the seeder; atomic upserts have concurrent/race tests;
only own-module code and explicitly authorized scripts/docs/example/log change;
existing Swagger/HTTP pagination remain unmodified and regression-tested; all
checks pass; no real credentials, card data, console.log or dead code were added;
the AI log records the work. Actual production provisioning and PR publication
remain deliberate later operator/student actions after review.

## Administrator account list — ACC-14 / SCRUM-43

The runtime `AdminModule` adds `GET /api/admin/accounts`. The ACC-18 command
documented above remains standalone and is not invoked by module registration
or application startup. No seeding implementation or existing User schema was
changed for ACC-14.

This endpoint requires the existing authenticated ADMIN principal. The global
JWT/status guard rejects missing, invalid or inactive authentication with 401;
the existing RolesGuard rejects authenticated USER, AIRLINE_MODERATOR and
HOTEL_MODERATOR callers with 403. `AdminService.listAccounts()` repeats the
principal/role checks for direct service calls.

| Query | Behavior |
| --- | --- |
| `page` | Shared PaginationDto; default 1, positive integer |
| `limit` | Default 10, positive integer, maximum 50 |
| `search` | Optional case-insensitive literal substring of name OR email; trimmed, maximum 100 characters after trimming; blank means no search |
| `role` | Optional exact shared Role enum value |
| `status` | Optional exact shared AccountStatus enum value |

Search, role and status combine in the MongoDB filter before shared `paginate()`
runs. Search metacharacters are escaped, never interpreted as caller-supplied
regex syntax. Arrays, invalid enums, oversized search and unsupported query
parameters return the standard field-level 400 response. DTO validation is also
applied inside the service for internal callers. No arbitrary MongoDB filter,
sort, projection or operator is accepted.

Example request:

```http
GET /api/admin/accounts?search=example&role=USER&status=ACTIVE&page=1&limit=10
```

Example response (synthetic account):

```json
{
  "items": [
    {
      "id": "673000000000000000000001",
      "name": "Example Account",
      "email": "example@example.test",
      "role": "USER",
      "status": "ACTIVE",
      "createdAt": "2026-11-01T09:00:00.000Z"
    }
  ],
  "page": 1,
  "limit": 10,
  "total": 1,
  "totalPages": 1
}
```

No matches return `{ items: [], page: 1, limit: 10, total: 0, totalPages: 0 }`.
Pages beyond the end return empty items while retaining the actual filtered
total/totalPages. All roles and statuses, including inactive target accounts,
can appear in this administrator-only list. The caller must still be active.

Ordering is ascending `_id`, matching the shared default and remaining
deterministic when registration timestamps are equal. Offset pagination is not
a transactional snapshot across concurrent account insertions/deletions.
Case-insensitive substring search can scan the users collection; the existing
email index is not a general substring-search index. A future search/index
redesign would require coordination with the User schema owner.

An explicit inclusion projection loads only `_id`, name, email, role, status and
createdAt. A separate response mapper returns exactly the six public fields
above, converting the ID and UTC timestamp to strings. Password hashes, tokens,
login counters, lockout/consent information, phone, provider links and MongoDB
metadata are excluded. Listing uses read operations only. Database failures
produce a sanitized 500 without attaching raw driver messages or causes.

Swagger documents cookie auth, all five query parameters, the paginated response
DTO and 200/400/401/403/500 responses. No account update, suspension or password
reset endpoint is introduced. ACC-16 and ACC-07a remain separate tickets.

### ACC-14 tests and ownership

- `admin.service.spec.ts`: direct authorization, literal filter construction,
  inclusion projection, strict output mapping, internal validation and failures.
- `backend/test/admin-accounts.e2e-spec.ts`: real AppModule and disposable MongoDB;
  all caller roles, defaults/boundaries, 27 equal-timestamp rows, name/email
  searches, regex metacharacters, every role/status, combined filters, empty
  results, unchanged stored accounts, secret exclusion and generated Swagger.
- `backend/test/pagination.e2e-spec.ts`: the authorized route-table entry adds
  this list using its two existing synthetic accounts; all pre-existing
  assertions remain unchanged. This is a shared-test integration change.

Tests use synthetic users/JWT keys, disposable MongoDB and a temporary upload
directory. They mock dotenv and disable environment-file loading before
importing AppModule. Verification runs in a copy excluding environment files;
do not point tests at the shared Atlas database or real accounts.

```powershell
npm test -- --runInBand src/admin/admin.service.spec.ts
npm run test:e2e -- --runInBand admin-accounts.e2e-spec.ts
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build
npm run lint
```

ACC-14 reads Ziad's existing User schema without modifying it. Other production
modules are untouched except the authorized minimal AppModule registration.
No dependencies, scripts, shared pagination or authentication code changed.

Verification on 2026-11-13, after synchronization to `cd9d6ef`: full Jest
796/796 (49 suites), full standard E2E 913/913 (34 suites), build and ESLint
passed. ACC-14 contributes eight service tests and 42 database-backed HTTP/E2E
tests, all passing. Focused commands also passed during implementation. Tracked
and new-file whitespace checks passed. No packages were installed and no shared
database was accessed. The full E2E run emitted EventEmitter listener warnings
without test failures; shared test infrastructure was not changed to suppress them.

Live SCRUM-43 checklist evidence:

| Jira item | Evidence / status |
| --- | --- |
| Non-admin gets 403 | PASS: all three non-admin roles tested through real global guards; missing/invalid auth gets 401 |
| Pagination works, page size 10 | PASS: defaults, custom/max limits, invalid values, equal-time stable ordering, out-of-range pages and shared whole-app pagination suite |
| Search matches name/email; role and status combine | PASS: actual MongoDB queries test both OR branches, case/whitespace, literal regex characters, every enum and combined filters before totals/pagination |
| Password hash never returned | PASS: inclusion projection plus six-field mapping; HTTP assertions exclude secrets and compare persisted documents before/after requests |
| Swagger updated; PR names ACC-14; shared PR checklist | Swagger PASS. Technical shared-checklist evidence is below. Actual PR title/publication remains pending student approval; no PR was created |

Shared PR-template evidence: scope is ACC-14 only; User schema, enums, guards,
errors and pagination are reused; service authorization and query validation are
covered; there is no request body or state-changing/concurrency-sensitive write;
all six response fields are explicit; the only cross-module production change
is authorized AppModule registration, and the shared pagination-table edit was
separately authorized. Swagger and real HTTP tests cover success, invalid input,
unauthenticated and wrong-role calls. Full checks pass; no credentials, .env
access, dependency edits, console logs or unrelated changes were added. The AI
prompt log records the request and follow-up authorizations. The student can use
`feat(admin): list accounts with search and filters (ACC-14)` as the eventual PR
title after independent review; PR descriptions/checklists were not edited here.

## ACC-07a / SCRUM-45 — Preparation history (superseded by integration below)

<details>
<summary>Earlier preparation and approval status; retained as history</summary>

**Coordination update, 2026-11-13:** Ahmed has approved the complete feature,
including User/auth/common changes; Ziad will review the authentication changes.
Mohamed confirmed that Ziad's explicit no-competing-work confirmation is still
pending. The historical approval checklist below now describes the integration
scope, not a request to repeat Ahmed's approval. Protected edits and endpoint
registration remain deferred until the task's ownership coordination condition
is satisfied.

**Not a working password-reset endpoint.** No reset controller/provider has been
registered, no account password is changed by this work, and forced-change
enforcement has not been implemented. The existing AdminModule/ACC-14 behavior,
ACC-18 seeding and protected authentication/User/common sources remain unchanged.
This branch does not depend on unmerged ACC-16 PR #83.

### Confirmed policy decisions

Mohamed selected the following during implementation:

- Only ACTIVE USER, AIRLINE_MODERATOR and HOTEL_MODERATOR targets may receive a
  reset; inactive and ADMIN targets are rejected, never reactivated or relinked.
- The temporary credential permits **strictly one successful login**. Loss of
  the restricted session or login response may require another administrator
  reset. A boolean forced-change flag alone cannot enforce this policy.
- Proposed delivery is a single ADMIN-only response with `Cache-Control:
  no-store` (and no-cache handling), never email, notification, audit or logs.
  No HTTP disclosure exists until the protected integration is approved and
  implemented. Operator/browser handling is still a secret-handling responsibility.
- Protected integration was initially pending owner approval. Ahmed's subsequent
  approval is recorded above; Ziad's coordination confirmation remains pending.

### Independent components completed

`TemporaryPasswordService.generate()` creates 24 cryptographically random bytes
(192 random bits), encodes them as base64url and adds a fixed letter/digit prefix.
The result is 34 ASCII characters; the prefix contributes no entropy. The shared
`IsValidPassword` decorator validates the candidate, and bcrypt uses the existing
`BCRYPT_SALT_ROUNDS` constant and a fresh salt. The service does no persistence or
delivery. Its internal result contains ephemeral plaintext for future approved
handoff and the salted hash; neither is logged. Crypto/hash/validation failures
are replaced with a fixed 500 message without values or raw causes.

`PasswordResetTargetService.getEligibleTarget()` is read-only preflight. It checks
ADMIN authorization in the service, validates the ID, selects only ID/role/status
from the existing User model, and enforces the chosen ACTIVE-only policy.
Missing authentication is 401, non-admin callers 403, malformed ID 400, missing
account 404, and unsupported target role/status 409. It returns no password/hash.
This read is not a concurrency-safe reset: the eventual atomic update must
recheck eligibility and expected credential state after generation.

`AdminPasswordResetParamsDto` and the deliberately empty body DTO prepare route
validation. Administrators will not submit a password, role, status or replacement
target in the body. These classes do not publish a route or claim Swagger/API
integration. Only a hash may eventually be stored in MongoDB; current tests verify
generation/hashing, not database reset persistence.

### Owner approval checklist — proposed design, not an implemented contract

| Owner / files | Required coordinated change and test |
| --- | --- |
| Ziad: `users/schemas/user.schema.ts` | Add forced-change state, credential version and single-use temporary-login consumption state. Defaults must preserve existing accounts; reset sets the new hash/flag/version/unused state together |
| Ziad: `users/users.service.ts` | Atomic reset/temporary-login claim; compare-and-set replacement tied to expected hash/version, clearing forced state and advancing the forced session version. Test reset/change and simultaneous-login races |
| Ziad: `auth/auth.service.ts` | Permit exactly one valid temporary login through an atomic claim; issue only restricted access; check credential versions on login/session creation and refresh; complete forced change without overwriting a newer reset |
| Ziad: `auth/auth.controller.ts`, `auth/dto/user-response.dto.ts` | Signal forced-change state; permit compliant replacement through the existing password endpoint; clear forced-session cookies after completion and require fresh normal login. Preserve ordinary change-password behavior |
| Ahmed/Ziad: `common/guards/jwt-auth.guard.ts`, `common/guards/account-status.ts`, access/principal interfaces and narrowly scoped route metadata | Read current forced/version state on every protected request, invalidate pre-reset sessions and permit only approved password-change/minimal-session handlers while forced. No frontend-only restriction or broad URL exception |
| Ahmed/Ziad: `auth/auth.module.ts`, related tests and `docs/contracts.md` | Wire/publish the agreed session-check contract and JWT version semantics; preserve normal registration/login/refresh/logout, lockout, moderator and ACC-14 behavior |

Recommended version policy: legacy tokens without a version are version zero only
for unchanged accounts; an administrative reset advances the stored version so
old access and refresh tokens fail. Forced completion advances it again, so a
temporary-login session cannot become an unrestricted session merely because
another request cleared the flag. Existing per-JTI logout revocation stays intact.
Ordinary password-change session behavior should remain unchanged. These choices
are now covered by Ahmed's implementation approval, subject to Ziad's pending
no-competing-work confirmation before protected files are edited.

Strict single-use requires atomically consuming the temporary-login capability
after password verification and before issuing a restricted session. If that
claim succeeds but session issuance/delivery fails, the credential remains used;
the selected recovery is another administrator reset, not silently making it
reusable. Refresh and restricted-handler policies must also be enforced by the
backend. No such claims/state/guard exceptions have been introduced in this phase.

### Focused verification

The tests exercise actual crypto/bcrypt, shared password/input validators, fresh
salts, random/hash failure redaction and role/status/ID policy with mocked reads.
No generated plaintext is included in snapshots, assertions that print its value,
logs, notifications or database records. No database or real account was used.
Full auth/account E2E and regression verification is deferred until owner-approved
integration is complete. SCRUM-45 remains incomplete, including its one-use,
forced-change, persistence, HTTP authorization and Swagger checklist items.

Verification on 2026-11-13: the two focused unit suites passed all 19 tests;
the backend TypeScript build and ESLint for the five new TypeScript files passed.
Checks ran in an environment-free temporary copy using existing dependencies,
without loading the real `.env` or connecting to a database. Full Jest/E2E and
full-repository lint were not run for this independent preparation phase.

### Approved completion requirements and safe preparation follow-up

The new task requires `tokenVersion`-based access **and** refresh invalidation,
24-hour expiration, atomic one-use consumption, and a conditional forced change
that clears temporary state, advances the version and requires fresh login.
`@AllowWhenMustChange()` must restrict forced sessions by default, with only
change-password, me and logout allowed. Public behavior and ordinary account
password changes must retain their existing behavior. These are requirements,
not implemented guarantees on this branch.

The existing generator now returns `expiresAt`, exactly 24 hours after generation
begins (hashing time does not extend it). The prepared
`AdminPasswordResetResponseDto` describes ID, one-time plaintext and UTC expiration;
it is not exposed through any route yet. Expiration is not persisted or enforced
until the coordinated integration is implemented.

The final reset must await the existing AuditService with actor/target/action;
plaintext, hashes, cookies and JWTs must never enter its input. An audit failure
after the atomic reset must return an error explaining that credentials may
already have changed, without unsafe rollback. No reset audit is emitted by
these independent preparation helpers.

Read-only GitHub checks on 2026-11-13 found open PRs #82 and #83. Their changed
file lists contain no `auth/`, `users/`, or global auth-guard changes. PR #83
overlaps AdminModule, this README, the prompt log and `docs/contracts.md`; resolve
those overlaps during eventual integration/review without stacking on it or
altering Git history here. Open-PR inspection cannot establish the absence of
Ziad's unpublished work and does not replace his explicit confirmation.

Follow-up verification: both focused suites passed **20/20** tests; backend build
and ESLint for all six prepared Admin TypeScript files passed. These checks used
the environment-free temporary copy and existing dependencies. Full Jest/E2E
and full lint remain deferred because the approved integration is not yet done.

</details>

## ACC-07a / SCRUM-45 — Integrated administrator-assisted password reset

Ahmed explicitly approved implementation across Admin, User, auth, shared guards
and authentication contracts. Mohamed subsequently clarified that Ziad's pending
no-competing-work confirmation is final coordination rather than a prohibition on
isolated local implementation. Ziad reviews these authentication changes.
The previous preparation-only statements above describe the earlier phase.

### Endpoint and target policy

`POST /api/admin/users/:id/reset-password` is registered by the existing
`AdminModule`, already imported by production `AppModule`. No AppModule edit or
dependency on unmerged ACC-16 code was needed. ACC-18 seeding and ACC-14 account
listing remain intact.

- The existing global guards enforce authentication and ADMIN role; the service
  also authorizes through the existing target-eligibility helper.
- The target must be ACTIVE and USER, AIRLINE_MODERATOR or HOTEL_MODERATOR.
  ADMIN/inactive targets return 409; missing targets 404, malformed IDs and
  unsupported body fields 400, non-admin callers 403, missing/invalid auth 401.
- Send `{}`; the administrator does not choose the password or alter account
  role/status/provider associations. Success is 200 with `id`, `temporaryPassword`
  and UTC `expiresAt`, plus `Cache-Control: no-store` and `Pragma: no-cache`.
  Plaintext is disclosed in that response only; there is no recovery/read-secret
  endpoint, email, notification or stored plaintext copy.
- Generation reuses the prepared crypto/bcrypt/password-validator implementation.
  Expiration is exactly 24 hours after generation starts. The conditional update
  rechecks allowed role, ACTIVE status and the observed version, sets the salted
  hash/forced/expiration/unused state, increments `tokenVersion`, and clears login
  failure/lockout state. It changes no bookings or content. Competing reset or
  forced-completion updates based on an older version return 409.

### Authentication lifecycle

1. Reset atomically invalidates every older access and refresh credential by
   advancing `tokenVersion`. Both newly signed JWT kinds include that version.
2. The global guard reads current status/version/forced state from MongoDB on
   each protected request. Missing version on legacy accounts/tokens means zero;
   it never means the latest database version. Malformed/stale versions fail 401.
3. Correct temporary login conditionally consumes the credential in one update
   matching hash/version/ACTIVE/unused/unexpired/unlocked state. Incorrect
   passwords do not consume it. Exactly one concurrent login can win. A consumed
   or expired credential returns generic 401 and issues no usable new session.
4. The returned user DTO includes `mustChangePassword: true` for forced accounts.
   `@AllowWhenMustChange()` marks only PATCH `/api/auth/change-password`, GET
   `/api/auth/me` and logout. All other protected routes default to 403 while
   forced. RolesGuard still runs. Public routes retain their behavior; logout
   remains public/idempotent. Refresh rejects forced accounts with 401 and clears
   cookies instead of extending the restricted session.
5. Forced replacement uses the existing min-8/letter/digit/max-72-UTF8-byte
   validator and requires a different password. It matches the authenticated
   version, expected hash, ACTIVE/forced/consumed state, stores a fresh salted
   hash, clears the flag and temporary markers, and increments the version again.
   Both cookies are cleared; login with the new password restores normal access.
   An old in-flight change cannot overwrite a more recent reset. Ordinary
   password changes retain their current-session behavior and also match version.

New User defaults are `mustChangePassword: false` and `tokenVersion: 0`; temporary
markers are optional and excluded from default Mongoose selection. Only code
verifying credentials explicitly loads them. Public/profile/account DTOs exclude
hashes, temporary markers and versions. The authenticated principal carries the
verified version internally so password replacement cannot trust a later read
alone. `isActive()` remains available for existing consumers; the guard now uses
`getAuthenticationState()` for one indexed read of status/version/forced state.

### Audit, recovery and limitations

After persistence the endpoint awaits the unchanged `AuditService.log()` contract
with administrator ID, `ADMIN_PASSWORD_RESET`, target type `USER`, target ID and
service-generated timestamps. There are no secrets, hashes, cookies or JWTs in
audit input. Credential-update driver errors are replaced with fixed errors so
the exception logger cannot print update documents or credential hashes.

Audit failure after reset returns 500 explicitly saying credentials changed;
the response does not disclose the secret and there is no unsafe rollback.
Credential update and audit persistence are not transactionally atomic. A crash
between them may leave an unaudited reset. Another ADMIN reset recovers a lost
secret; successful reset requests are intentionally not idempotent. Concurrent
requests that read the same version have one winner; later requests may perform
a fresh reset and invalidate a previously disclosed temporary credential.

Temporary consumption precedes session issuance. A signing/delivery failure or
lost session leaves it consumed; another admin reset may be required. Restricted
sessions have the existing access-token lifetime and cannot refresh. Expiration
limits temporary **login**, not an already authenticated password-change request.
Version invalidation applies at subsequent authorization/refresh checks; it does
not cancel requests already authorized or reverse completed business actions.

Read-only open-PR checks found no auth/User/global-guard overlap in #82/#83.
PR #83 overlaps AdminModule/documentation/contracts, so final coordination must
preserve both tickets when it merges. No ACC-16 implementation was copied here.
Ziad's confirmation/review remains outstanding; no Git history or PR was changed.

### Evidence and SCRUM-45 checklist

`test/admin-password-reset.e2e-spec.ts` uses actual production AppModule, its
global guards, real HTTP/cookies/bcrypt and disposable MongoDB. A test-only
protected controller proves newly added routes deny forced sessions by default;
no auth guard or authentication service is replaced. Controlled spies only force
failure/race timing. Synthetic raw inserts also test pre-version legacy accounts.

The 28 AppModule cases cover supported roles, rejected callers/targets/input,
salted hash and expiration persistence, old-password rejection, wrong/expired/
consumed/concurrent temporary login, session-issuance failure after consumption,
legacy/current access and refresh invalidation, allow-list/default denial, public
routes, replacement validation and completion, ordinary login/change/refresh/
logout and suspension checks, moderator provider IDs, unchanged booking/content
rows, ACC-14 safe listing, audit success/failure, credential-log redaction, three
reset/change race directions, concurrent resets and generated Swagger.

| Ticket checklist | Evidence |
| --- | --- |
| ADMIN-only reset; non-admin 403 | Global roles plus service authorization; HTTP and helper tests |
| Generated temporary password stored only as salted hash; works once | Actual crypto/bcrypt unit tests, stored hash/expiry assertions and concurrent MongoDB claim test |
| mustChangePassword forces compliant replacement next login | Real guard allow-list, validator errors, atomic completion, token/cookie invalidation and fresh-login tests |
| User and both moderator targets supported | HTTP cases for all three roles with provider association preservation |
| Swagger, ACC-07a PR and shared checklist | Actual Swagger assertions pass; PR publication is intentionally not performed. Scope/ownership approval is documented here and in contracts; tests validate authorization, inputs, concurrency, response safety and regressions |

Focused verification: **101/101 unit tests** across five suites and **28/28
AppModule E2E tests** passed. Tests run in an environment-free temporary copy
with existing dependencies, temporary storage and disposable MongoDB only.

Final sequential verification on 2026-11-13:

| Check | Result |
| --- | --- |
| Focused Blog test-adapter regression | 24/24 tests, 2 suites passed |
| Full Jest: `npm test -- --runInBand` | 869/869 tests, 55 suites passed |
| Full E2E: `npm run test:e2e -- --runInBand` | 1,032/1,032 tests, 39 suites passed |
| TypeScript: `npm run build` | Passed |
| Full ESLint: `npm run lint` | Passed |

The first full Jest run exposed two existing Blog test doubles implementing only
the old status-checker method. Adding the new checker method preserved their
status policy and all assertions; the focused adapter suites and full Jest rerun
passed. No production fallback bypass was introduced. Full E2E emitted listener
warnings; they were not suppressed or addressed through unrelated changes.
Final Git whitespace and tested-source identity checks passed; no unresolved
conflicts or unrelated changes were found. No dependency installation or shared
Atlas access was performed.

### Changed-file map for independent review

All paths below are relative to the repository root; the pre-existing preparation
is included in this uncommitted feature diff.

| Area | Files |
| --- | --- |
| Admin implementation | `backend/src/admin/admin.module.ts`, `admin-password-reset.controller.ts`, `admin-password-reset.service.ts`, `password-reset-target.service.ts`, `temporary-password.service.ts` (the last four share the same Admin directory) |
| Admin DTOs/tests/docs | `backend/src/admin/dto/admin-password-reset.dto.ts`, `backend/src/admin/dto/admin-password-reset-response.dto.ts`, `backend/src/admin/password-reset-target.service.spec.ts`, `backend/src/admin/temporary-password.service.spec.ts`, `backend/src/admin/README.md` |
| Auth integration/tests | `backend/src/auth/auth.controller.ts`, `backend/src/auth/auth.module.ts`, `backend/src/auth/auth.service.ts`, `backend/src/auth/auth.service.spec.ts`, `backend/src/auth/dto/user-response.dto.ts` |
| User integration/tests | `backend/src/users/schemas/user.schema.ts`, `backend/src/users/users.service.ts`, `backend/src/users/users.service.spec.ts` |
| Shared guard contract | `backend/src/common/decorators/allow-when-must-change.decorator.ts`, `backend/src/common/decorators/index.ts`, `backend/src/common/guards/account-status.ts`, `backend/src/common/guards/jwt-auth.guard.ts`, `backend/src/common/guards/guards.spec.ts`, `backend/src/common/interfaces/access-token-payload.ts`, `backend/src/common/interfaces/authenticated-user.ts` |
| Necessary existing test adapters | `backend/src/blog/comments.integration.spec.ts`, `backend/src/blog/likes.integration.spec.ts` (only add the new checker method to the existing test doubles; preserve assertions), `backend/test/auth.e2e-spec.ts` (expect verified tokenVersion on the test-only principal response) |
| Application E2E and records | `backend/test/admin-password-reset.e2e-spec.ts`, `docs/contracts.md`, `AI_PROMPTS.txt` |

No production Blog code, dependencies, global test configuration/scripts,
AppModule, shared AuditService, CSV data or other developers' feature behavior
was changed. These minimal existing test adapters are required by the explicitly
approved authentication-checker/principal contract extension.
