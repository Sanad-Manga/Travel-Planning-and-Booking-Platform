# Official reference data — SCRUM-18 / GEN-12

This module seeds the university CSVs and provides internal NestJS lookups. It adds
no HTTP endpoints, startup hooks, admin users, or currency conversion. The workbook's
exact GEN-12 acceptance criteria have not been independently verified.

## Setup and explicit execution

The runtime dependency `csv-parse` is pinned to `7.0.3` in
`backend/package.json` and included in `backend/package-lock.json`. From
`backend/`, use `npm ci` to install the locked dependencies; no separate parser
installation or manifest change is needed. `csv-stringify` generates CSV and
cannot parse it. No additional npm script is required.

The team lead approved the `csv-parse` dependency when reviewing PR #12.

The university files are tracked in Git at `backend/data/Countries.csv`,
`Cities.csv`, `Airports.csv`, and `Attractions.csv` (the university's "Mock Data"
sheet). To use a different official set, pass its folder as the optional CLI
argument below; the headers must match exactly. Do not substitute generated
records. The original files are not changed by this module.

From `backend/`, after configuring the intended database in the existing `.env`:

```powershell
npm run build
node --env-file=.env dist/reference-data/seed/seed.js
```

Alternatively supply `MONGODB_URI` explicitly in the process environment and run:

```powershell
node dist/reference-data/seed/seed.js
```

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

## Service integration — proposed signatures for team review

The existing contract approves the service's lookup responsibility, but supplies
no method names. No existing usages/signatures were found. These new methods need
team review before consumers adopt them:

```typescript
findCountryById(code: string): Promise<Country | null>
findCityById(city_id: string): Promise<City | null>
findAirportById(iata_code: string): Promise<Airport | null>
findAttractionById(attraction_id: string): Promise<Attraction | null>
findCurrencyById(code: string): Promise<Currency | null>
```

The returned types are the schema classes' official fields only. Lookups are exact
and case-sensitive, return `null` when absent, and exclude `_id`, `__v` and
timestamps. They are internal records, not public response DTOs. Future HTTP
controllers must implement the team's response DTO conventions; if exposing an
internal MongoDB `_id` as string `id`, retain the official ID in its named field.

Consumer owners import `ReferenceDataModule` in their own Nest module's `imports`
and inject `ReferenceDataService`. The module reuses the root Mongoose connection.
There is no global module registration. Root-only registration does not make the
service visible inside sibling modules. `AppModule` need not change for this
standalone CLI or reusable provider: a registered consumer imports the module
transitively. No shared app setup or consumer modules were edited. If the lead
wants direct root registration, the exact optional change is importing
`ReferenceDataModule` and adding it to `AppModule.imports`; obtain approval first.

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
CLI itself so it also runs on a fresh checkout. Tests never import `AppModule`,
load `.env`, or fall back to a development URI. Database cleanup targets only the
server created by that suite. No Swagger/auth/role tests apply: no routes are added.

Observed on 2026-11-04: build PASS; Jest PASS (55 tests across four suites, including
eight isolated MongoDB/CLI tests); ESLint PASS; existing e2e PASS (six tests);
`git diff --check` PASS. The compiled CLI ran twice against the disposable server,
inserting 7/8/8/8/8 records in seed order on the first run and zero on the second.
These initial verification results used a temporary parser installation before
the dependency was declared. The manifest and lockfile now include the parser.
The independent read-only review checked their consistency without rerunning
installation, build, tests or seeding. The shared Atlas database was never accessed.

Independent code-review verdict: **APPROVE** — no blocking implementation defects
found. Remaining team coordination includes confirming approval of the existing
shared dependency-file changes, reviewing the proposed public method names, and
deciding how to distribute/track the four official CSVs.
Work remains on `feature/GEN-12-reference-seeding`. This documentation cleanup
changes only this README and appends entries to `AI_PROMPTS.txt`; it does not
change implementation or dependency files, install packages, stage changes,
commit, push, or create a PR. No credentials or `.env` contents were inspected
or exposed.
