# Reference data and airports API — GEN-12 / FLT-02

GEN-12 seeds the university CSVs and provides internal NestJS lookups. FLT-02
(SCRUM-19) adds the public, read-only `GET /api/airports` endpoint. This module
does not seed on startup or provide airport mutation routes. The workbook's exact
GEN-12 acceptance criteria have not been independently verified.

## Airports API — SCRUM-19 / FLT-02

`GET /api/airports?page=1&limit=10` is accessible to guests through the existing
global auth guards using `@Public()`. Only `page` and `limit` are accepted: defaults
are 1 and 10; the maximum limit is 50. Unsupported parameters or invalid pagination
return the shared 400 validation-error response. Swagger is available at `/api/docs`.

The shared pagination envelope contains `items`, `page`, `limit`, `total` and
`totalPages`. Each item is an `AirportResponseDto`:

```json
{
  "id": "507f1f77bcf86cd799439011",
  "iataCode": "CAI",
  "name": "Cairo International Airport",
  "city": { "cityId": "cairo", "name": "Cairo" },
  "country": { "code": "EG", "name": "Egypt" },
  "timeZone": "Africa/Cairo"
}
```

`id` represents MongoDB's internal ObjectId as a string; `iataCode` remains the
official airport identifier used by other modules. City/country identifiers and
names come from the reference collections. `timeZone` preserves the IANA name.
Only response fields are mapped; raw documents, timestamps and `__v` are excluded.

`ReferenceDataService.listAirports(pagination: PaginationDto)` returns
`Promise<PaginatedResponse<AirportResponseDto>>`. It uses shared `paginate()` for
database-side count, skip and limit, ordered by `iata_code` then `_id`. City and
country names are resolved in two bounded queries for the current page, without
loading all airports or issuing one relationship query per airport. Empty or
out-of-range pages return an empty `items` array with the appropriate totals.
Missing/inconsistent city or country references produce a controlled 500 error;
unexpected database failures use the global exception filter without leaking details.

There are no POST, PUT, PATCH or DELETE airport routes. Flight creation, search and
time-zone conversion remain outside this ticket.

The endpoint has no hardcoded dataset size, records, countries or CSV order. After
the corrected university datasets arrive, the existing GEN-12 validation/seeding
process can populate them without an API rewrite when the schema stays compatible.
GEN-12 upserts retain obsolete identifiers absent from replacement files; those
records will still appear in the API until the team separately approves a cleanup.
FLT-02 adds no automatic deletion or migration and does not modify the CSVs.

### FLT-02 verification and review evidence (2026-11-04)

| Check | Observed result |
| --- | --- |
| Focused actual-AppModule HTTP/Swagger tests | PASS: 18 tests |
| `npm run build` | PASS |
| `npm test -- --runInBand` | PASS: 266 tests across 20 suites, including the 18 airports tests |
| `npm run lint` | PASS after correcting a formatting-only issue in the new test |
| `npm run test:e2e -- --runInBand` | PASS: 81 tests across six suites |

Verification used a temporary backend copy without any environment files and
reused installed dependencies without installing packages. The new suite starts
the real AppModule on a local ephemeral port, retaining Auth, Payments and
Notifications, with its own MongoMemoryServer and synthetic JWT settings.
`/api/airports`, `/api/docs` and `/api/docs-json` were exercised over HTTP.
Existing protected auth/notification routes still require authentication, and
the broader regression suites pass. No production seed or shared Atlas access ran.

Each item in the supplied task's acceptance checklist was reviewed:

| Acceptance item | Status and evidence |
| --- | --- |
| `GET /api/airports` implemented | PASS: actual AppModule HTTP requests return 200 |
| IATA, name, city, country, IANA zone | PASS: response DTO fields compared against official CSV values and names |
| Original identifiers preserved | PASS: IATA codes, city IDs and country codes are mapped without normalization |
| No mutation endpoints | PASS: POST/PUT/PATCH/DELETE on list and item paths return 404; data remains unchanged |
| Root module integration | PASS: only the import and imports-array entry were added; module/service are resolved in the real app |
| Guest access | PASS: requests without credentials and with an invalid cookie return 200 |
| Contract pagination | PASS: defaults 1/10, maximum 50, custom/beyond-last pages, actual totals and invalid-query errors |
| Swagger completeness | PASS: public GET operation, pagination defaults/maximum, nested DTO schemas and 200/400/500 responses |
| Different dataset sizes | PASS: 63 reverse-inserted fixtures, stable pages and dynamic database updates |
| CSVs unchanged | PASS: no dataset edits; repository hash comparison verifies their contents |
| Tests/build/lint | PASS: observed results above |
| AI usage documented | PASS: FLT-02 entry appended to AI_PROMPTS.txt |
| Binding conventions | PASS: shared pagination, Public decorator, error DTO/filter, response mapping and official-ID relationships |
| PR-template preparation | PASS: review evidence below; no PR has been created or updated |

The live [SCRUM-19 checklist](https://ahmedsanadprojects.atlassian.net/browse/SCRUM-19)
was read without changing it. Its first three items (required fields, exact IDs,
read-only routes) are verified above. Its final item has verified Swagger and the
PR-template evidence below; applying a PR title/description remains pending the
student's explicit publication authorization. Live Jira checkboxes were not ticked.
Flight creation/search owners must use official airport IDs and the existing
lookup service; enforcing their input rules belongs to FLT-03/FLT-11.

PR-template preparation, for the student's later review:

- Ticket: SCRUM-19 / FLT-02. Proposed title: `feat(reference-data): expose read-only airports API (FLT-02)`.
- Changes/affected owners: reference-data DTO, service and public controller; the explicitly authorized AppModule import/registration must be highlighted for Ahmed Sanad.
- Checklist walkthrough and acceptance: each supplied criterion and the live Jira checklist are reviewed above; PR metadata publication is pending authorization.
- Shared conventions: reused PaginationDto, paginate, ApiPaginatedResponse, Public and ErrorResponseDto; no new enums, money/date conventions or consumer interfaces were duplicated.
- Auth/ownership: the endpoint is intentionally public and returns shared reference data; wrong-role and another user's private-resource cases do not apply.
- Validation/business rules: the shared global pipe rejects invalid/unknown pagination; the service checks city/country consistency while mapping.
- Concurrency: read-only queries add no reservation or read-then-write logic; atomic-write tests do not apply. Deterministic page results are tested.
- Scope: own module plus the authorized AppModule registration and AI log; other modules, common code, CSVs and dependencies are unchanged.
- Swagger/pagination: verified generated JSON and documentation route over HTTP, including failure responses.
- Tests/build/lint: new actual-app tests and broader regressions pass as recorded above.
- Hygiene/AI usage: no credential files, console logs, dead code, commits, pushes or PR updates were introduced; the AI log records the implementation and verification.

## Setup and explicit execution

The runtime dependency `csv-parse` is pinned to `7.0.3` in
`backend/package.json` and included in `backend/package-lock.json`. From
`backend/`, use `npm ci` to install the locked dependencies; no separate parser
installation or manifest change is needed. `csv-stringify` generates CSV and
cannot parse it. The seed shortcut below reuses the existing CLI without adding
dependencies.

The team lead approved the `csv-parse` dependency when reviewing PR #12.

The university files are tracked in Git at `backend/data/Countries.csv`,
`Cities.csv`, `Airports.csv`, and `Attractions.csv` (the university's "Mock Data"
sheet). To use a different official set, pass its folder as the optional CLI
argument below; the headers must match exactly. Do not substitute generated
records. The original files are not changed by this module.

From `backend/`, after configuring the intended database in the existing `.env`:

```powershell
npm run seed
```

The `preseed` npm lifecycle hook runs `npm run build` first and, only if it succeeds, executes
`node --env-file=.env dist/reference-data/seed/seed.js`. This works with the
project's Node 22+ requirement and regenerates missing/stale compiled output.
It matches the existing env-file workflow: `backend/.env` must exist, and explicit
process environment values take precedence over values in that file. No seed runs
during installation or normal application startup.

To use a custom official data directory, including paths containing spaces:

```powershell
npm run seed -- "C:\official reference data"
```

npm forwards the argument to the existing CLI, not the separate `preseed` build.
Keeping `seed` as a direct Node command also preserves paths with spaces under
Windows npm argument escaping. For an authorized
later manual execution, the original two-step build/Node command remains valid.

Alternatively supply `MONGODB_URI` explicitly in the process environment and run:

```powershell
node dist/reference-data/seed/seed.js
```

This direct CLI alternative requires a prior `npm run build` and does not require
an env file when `MONGODB_URI` is already supplied explicitly.

The CLI itself never loads `.env` or `AppModule`. `--env-file=.env` is an explicit
Node 22+ option for an authorized later execution. Do not run the command against
the shared Atlas database during implementation/testing. Only the shared MongoDB
connection is needed; other modules' environment settings are not required.

The default data directory resolves relative to the seed file, in both source and
compiled output, independently of the working directory. A single optional CLI
argument overrides it, e.g. `node dist/reference-data/seed/seed.js C:\official-data`.
Missing files, unexpected headers, empty datasets/fields, malformed records,
duplicate IDs, unknown references, airport city/country mismatches, invalid IANA
time zones and non-uppercase three-letter currency codes fail before database
writes. Identifiers and time zones are never trimmed, recased or replaced.

The CLI prints one JSON result per completed collection: `collection`, `input`,
`inserted` (upserts), `matched` and `modified`. Failure exits with code 1; driver
errors are intentionally summarized to avoid leaking connection credentials.
Earlier completed collections may remain; rerun after fixing the failure.

## Database and reconciliation

| Collection | Unique canonical ID | Reference fields (indexed) |
| --- | --- | --- |
| `countries` | `code` | `currency` → currencies.code |
| `cities` | `city_id` | `country_code` → countries.code |
| `airports` | `iata_code` | `city_id` → cities.city_id; `country_code` → countries.code |
| `attractions` | `attraction_id` | `city_id` → cities.city_id |
| `currencies` | `code` | Derived distinct Countries.csv currency values |

All schemas use `timestamps: true`. MongoDB generates internal ObjectIds; these
never replace the official string identifiers. References store CSV IDs directly,
not ObjectIds. Named fields match the CSV headers consistently across collections.
The supported currency collection contains codes only, with no invented metadata.

All input is validated first. Declared indexes are created without dropping
existing indexes. If existing duplicates prevent unique index creation, seeding
fails for manual investigation; it never deletes or merges records automatically.
Atomic upserts run by canonical ID in order: currencies, countries, cities,
airports, attractions. Unique indexes enforce identity in MongoDB.

Reconciliation updates only official dataset fields with `$set`; it retains `_id`,
`createdAt`, unrelated fields, records absent from the CSV, and other collections.
Mongoose updates `updatedAt` on matched upserts, including unchanged records, so
`modified` may be nonzero on repeat runs. No deletes, collection resets, index
resets or transactions are used. A rerun safely completes interrupted collections
or batches; previously written records match the same unique IDs. Failures can
leave partial results, and the seed does not promise all-collection atomicity.

Verified input: **8 countries, 8 cities, 8 airports, 8 attractions, 7 currencies**.

## Service integration and GEN-12 query follow-up

The existing ID lookups and their signatures are preserved, including the methods
already consumed by hotels and itineraries. The four additional list-query names
are proposed for Ahmed's review before new consumers adopt them:

```typescript
findCountryById(code: string): Promise<Country | null>
findCityById(city_id: string): Promise<City | null>
findAirportById(iata_code: string): Promise<Airport | null>
findAttractionById(attraction_id: string): Promise<Attraction | null>
findCurrencyById(code: string): Promise<Currency | null>
listAirportsByCity(cityId: string): Promise<Airport[]>
listAirportsByCountry(countryCode: string): Promise<Airport[]>
listCitiesByCountry(countryCode: string): Promise<City[]>
listAttractionsByCity(cityId: string): Promise<Attraction[]>
```

The four internal list methods are the GEN-12 follow-up interface proposed for
Ahmed's review. No prior implementations or consumers of these names were found.
They filter by the exact official `city_id` or `country_code`, without trimming,
recasing or replacing identifiers. Unknown parents and known parents with no
matches both return `[]`; no separate parent-existence query is needed.

Airport results include `iata_code`, `name`, `city_id`, `country_code` and the
stored `time_zone`; cities include `city_id`, `name`, `country_code`; attractions
include `attraction_id`, `name`, `city_id`. Like the existing ID lookups, the lists
exclude `_id`, `__v` and timestamps. They are internal reference records, not HTTP
response DTOs. Sorting is ascending by the unique official identifier (`iata_code`,
`city_id` or `attraction_id`); attraction IDs use lexical, not numeric, ordering.

These internal methods intentionally return every match as a plain array rather
than silently applying the HTTP endpoint's pagination cap. Each performs one
MongoDB-side filtered/projected/sorted query using existing relationship indexes,
with no whole-collection in-memory filtering, counts, enrichment or N+1 queries.
The returned array's memory use scales with the matching group. If consumers later
need to stream groups too large to materialize, agree an explicit cursor/paged
interface rather than truncating these methods' complete-result contract.
Existing lookups and the paginated `GET /api/airports` method/signature are unchanged;
no additional HTTP routes, schemas, indexes, migrations or deletion behavior are added.

The lookup return types are the schema classes' official fields only. Lookups are exact
and case-sensitive, return `null` when absent, and exclude `_id`, `__v` and
timestamps. They are internal records, not public response DTOs. Future HTTP
controllers must implement the team's response DTO conventions; if exposing an
internal MongoDB `_id` as string `id`, retain the official ID in its named field.

Consumer owners import `ReferenceDataModule` in their own Nest module's `imports`
and inject `ReferenceDataService`. The module reuses the root Mongoose connection.
For FLT-02, `AppModule` now imports `ReferenceDataModule` and appends it to the
existing `imports` array to register `AirportsController`. The student explicitly
authorized these two integration changes; Ahmed Sanad must review this shared-file
modification. Existing Payments, Auth and Notifications registration is unchanged.
Root registration exposes the controller; sibling consumers still import the
module themselves to inject the service. The standalone seed CLI remains independent.
The GEN-12 follow-up verified that registration/export already exists, so neither
AppModule nor ReferenceDataModule required changes. Its consumer-module integration
test injects the exported service through normal NestJS module imports.

## Verification

From `backend/`:

```powershell
npm run build
npm test -- --runInBand
npm run lint
npm run test:e2e -- --runInBand
```

`seed/reference-data.loader.spec.ts` covers the actual CSVs, counts, ID preservation,
unique currency derivation, quoted/escaped/multiline fields, missing files and
invalid input. `reference-data.integration.spec.ts` starts its own disposable
MongoDB server and tests Nest injection, all lookups and misses, first/repeated
seeds, database uniqueness, reconciliation, interrupted-batch recovery, validation
before writes, and the real compiled CLI's results/exit behavior. It compiles the
CLI itself so it also runs on a fresh checkout. That suite uses its own explicitly
isolated connection rather than `AppModule` or a development URI. Cleanup targets
only the disposable server created by the suite.

`airports.integration.spec.ts` boots the real `AppModule`, guards, controllers,
global validation/error handling and Swagger against its own disposable MongoDB.
It disables dotenv/config environment-file loading and supplies synthetic JWT
configuration and an isolated URI. It verifies official CSV values, dynamic database
updates, guests (including an invalid cookie), empty results, 63 fixture airports,
default/custom/maximum pagination, deterministic pages, validation, read-only
routing, failure responses, Swagger schemas and existing module registration.
Regression commands are run from a temporary backend copy without `.env` so no
developer credentials or shared Atlas connection are used.

`reference-data.queries.integration.spec.ts` exercises all four internal queries
through a consumer module and disposable MongoDB. It covers multiple matches,
unrelated records, official fields and IANA zones, stable order, known/unknown empty
groups, exact identifiers and groups above the HTTP page limit.
`seed/seed-shortcut.integration.spec.ts` runs the real npm shortcut in a temporary
copy with no compiled output, links existing dependencies without installing any,
and writes only a synthetic `.env` pointing to its own disposable MongoDB server.
It checks build-before-seed, default datasets, a custom directory containing spaces,
explicit environment precedence and absence of the URI in command output. It never
reads or copies the developer's `.env` or seeds the team's shared database.

### GEN-12 follow-up verification (2026-11-04)

- Build and ESLint: PASS.
- Full Jest regression: PASS, 326 tests across 25 suites, including 13 new
  query/shortcut tests. Existing ID lookups and the public airports API still pass.
- Full e2e regression: PASS, 162 tests across 10 suites.
- The first shortcut attempt exposed Windows argument escaping with a combined
  `npm run build && node ...` script. Separate `preseed`/`seed` scripts corrected
  this; the final tests verify custom paths with spaces and env-file precedence.
- Four internal filters, multiple matches, exclusion of unrelated records,
  complete official fields/IDs, IANA zones, stable ordering, empty groups and
  larger groups are verified against actual disposable MongoDB collections.
- AppModule registration/export already exists; normal consumer-module injection
  is tested. AppModule, ReferenceDataModule, existing HTTP routes, schemas/indexes,
  CSVs and the lockfile remain unchanged. package.json changes only the two scripts.
- The npm shortcut was executed only in temporary copies with synthetic `.env`
  files and a generated disposable URI. No real credentials or shared database
  were used, no packages were installed, and no commit/push/PR update was performed.

For the follow-up PR checklist: scope is the reference-data service/tests/docs,
the explicitly requested shared package scripts and the AI log. New method names
need Ahmed's interface review; existing consumers/signatures are preserved. The
internal read-only queries add no HTTP routes, auth/ownership rules, money/date
fields or concurrency-sensitive writes. Existing Swagger, pagination and auth
behavior are regression-tested. GEN-12's upserts, validation and obsolete-record
retention policy are unchanged. Publication and Jira/PR checkbox updates remain
the student's responsibility; this task creates no PR.

Observed on 2026-11-04: build PASS; Jest PASS (55 tests across four suites, including
eight isolated MongoDB/CLI tests); ESLint PASS; existing e2e PASS (six tests);
`git diff --check` PASS. The compiled CLI ran twice against the disposable server,
inserting 7/8/8/8/8 records in seed order on the first run and zero on the second.
These initial verification results used a temporary parser installation before
the dependency was declared. The manifest and lockfile now include the parser.
The independent read-only review checked their consistency without rerunning
installation, build, tests or seeding. The shared Atlas database was never accessed.

Historical GEN-12 independent code-review verdict: **APPROVE** — no blocking implementation defects
found. Remaining team coordination includes confirming approval of the existing
shared dependency-file changes, reviewing the proposed public method names, and
deciding how to distribute/track the four official CSVs.
That GEN-12 documentation cleanup
changes only this README and appends entries to `AI_PROMPTS.txt`; it does not
change implementation or dependency files, install packages, stage changes,
commit, push, or create a PR. No credentials or `.env` contents were inspected
or exposed.
