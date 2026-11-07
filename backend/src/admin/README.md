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
