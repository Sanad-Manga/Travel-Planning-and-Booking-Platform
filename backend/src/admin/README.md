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
