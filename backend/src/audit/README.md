# GEN-07 / SCRUM-21 — Audit infrastructure

This module persists administrator and moderator action records and exposes an
administrator-only history. ACC-15 (administrator account/provider actions),
ACC-16 (suspension/reactivation) and GEN-10 (moderation/deletion) must import this
module and call its service when implementing their workflows. Those workflows
are outside SCRUM-21; their actions are not automatically audited yet. ACC-18
administrator seeding is not a dependency.

## Shared service contract

```typescript
AuditService.log({ actorId, action, targetType, targetId, details? }): Promise<void>
```

The four required fields are nonblank strings (maximum 1,024 characters), not
ObjectId-only identifiers. Official identifiers such as `CAI` are preserved.
`details?: Record<string, unknown>` accepts safe JSON administrative context.
Import the module and inject the exported service in the consuming module:

```typescript
import { Injectable, Module } from '@nestjs/common';
import { AuditModule, AuditService } from '../audit';

@Injectable()
export class ModerationService {
  constructor(private readonly audit: AuditService) {}

  async recordCompletedAction(actorId: string, targetId: string): Promise<void> {
    await this.audit.log({
      actorId,
      action: 'CONTENT_DELETED',
      targetType: 'Post',
      targetId,
      details: { reason: 'Policy violation', reportId: 'report-123' },
    });
  }
}

@Module({ imports: [AuditModule], providers: [ModerationService] })
export class ModerationModule {}
```

This is an integration example, not a deletion implementation. The caller must
authorize the action, derive `actorId` from the authenticated principal, and
await logging. The internal write contract does not accept a principal or
perform workflow authorization. Do not pass untrusted actor IDs from requests.

Each successful call awaits one MongoDB insert into `auditLogs`. Repeated calls
create separate records. No automatic retries or deduplication are performed.
Write failures reject with a sanitized HTTP 500 exception; validation rejects
with HTTP 400. No driver message or exception cause is forwarded. A workflow
mutation and its audit insert are not a single transaction through this API.
Callers must handle failure explicitly rather than claiming an audit record
exists. An uncertain network acknowledgement must not trigger a blind retry.

## Persistence and historical integrity

Documents contain `actorId`, `action`, `targetType`, `targetId`, optional `details`,
and server-generated Mongoose timestamps. Caller-supplied `_id`, `createdAt`,
`updatedAt` and other unrelated root fields are ignored. The compound index
`{ createdAt: -1, _id: -1 }` supports deterministic newest-first retrieval.
Mongoose uses the plural collection name `auditLogs`.

The feature is append-only: it exposes no update/delete service methods, mutation
endpoints, retention policy or TTL index. Database administrators still control
database-level access; this module does not provide tamper-proof storage.

## Safe details

Include reasons, affected resource identifiers, changed status names and other
minimal administrative context. Nested objects and arrays are supported without
a fixed business-field allowlist. Use ISO strings for dates. Values must be plain
JSON (finite numbers, strings, booleans, null, arrays and plain objects).

Never include passwords or hashes, access/refresh tokens, cookies, authorization
headers, Stripe secrets, card information or raw authentication request bodies.
The validator rejects sensitive key names at any depth, recognizable credential
strings and Luhn-valid card-number strings. It rejects cyclic/non-JSON data,
accessors, unsafe MongoDB/prototype keys, and excessive depth/size (10 levels,
1,000 values and 16 KiB serialized UTF-8). It copies accepted data before writing.
Invalid values are rejected rather than silently removed. Read mapping also
validates details, returning a sanitized 500 for unsafe legacy data.

These checks catch obvious mistakes, not every possible secret hidden under an
innocent name. Callers remain responsible for safe content, including the four
required string fields. Do not submit complete request, user or payment objects.
Validation and persistence errors never echo supplied context.

## HTTP and Swagger

`GET /api/admin/audit-logs` uses the application's existing JWT cookie guard and
`@Roles(Role.ADMIN)`. ADMIN receives 200, authenticated USER/AIRLINE_MODERATOR/
HOTEL_MODERATOR callers receive 403, and missing/invalid authentication receives
401. Service-level authorization also protects internal list calls.

Shared `PaginationDto` and `paginate()` provide default `page=1`, `limit=10`,
maximum `limit=50`, and validation errors (400) for invalid/unknown query fields.
Ordering is descending `createdAt`, then descending `_id`. The response is:

```json
{
  "items": [],
  "page": 1,
  "limit": 10,
  "total": 0,
  "totalPages": 0
}
```

Each item has string `id`, `actorId`, `action`, `targetType`, `targetId`, optional
`details`, and `createdAt` as an ISO 8601 UTC string. `_id`, `__v` and `updatedAt`
are excluded. Read failures return sanitized 500 responses. Swagger at
`/api/docs` documents cookie security, pagination, the DTO and 200/400/401/403/500.
The root `AppModule` imports `AuditModule`; the two-line registration was
explicitly authorized by Mohamed Walid during this task.

## Verification

Use disposable MongoDB only; do not load the team's `.env` or shared Atlas URI.
The audit tests mock dotenv and the root E2E fixture disables ConfigModule's
environment-file loading. Synthetic accounts/JWT keys exist only in test data.

From an environment-free backend verification copy with existing dependencies:

```powershell
npm test -- --runInBand src/audit
npm test -- --runInBand
npm run test:e2e
npm run build
npm run lint
```

The existing E2E configuration scans `test/`. The audit E2E file lives at
`backend/test/audit.e2e-spec.ts`, so the standard command used by GitHub CI
discovers it without configuration overrides. It was moved from `src/audit/`
during final SCRUM-21 review to follow the repository's E2E conventions.

- `audit.service.spec.ts`: shared contract, acknowledged writes, safe context,
  invalid/sensitive data, sanitized failures and direct list authorization.
- `audit.integration.spec.ts`: real persistence and timestamps, consumer-module
  injection, actual HTTP guards for all roles, 0/1/10/23/61 records, pagination,
  equal-time ordering, index, metadata exclusion, errors and Swagger.
- `../../test/audit.e2e-spec.ts`: boots the production `AppModule` against disposable
  MongoDB and verifies endpoint registration, authentication, persistence and
  generated application Swagger.

Verification on 2026-11-06 in an environment-free temporary backend copy:
The initial implementation passed 54/54 focused audit tests and 407/407 full
Jest tests (27 suites). Its standard E2E command discovered 201 tests; a custom
root override discovered 203. The final review corrected that discovery gap by
moving the two audit AppModule tests into `test/`. No packages were installed or
changed, and no shared database connection was made.

After relocation on 2026-11-06, the exact standard `npm run test:e2e` command
passed all 203 tests in 12 suites without overrides. The full Jest suite passed
407 tests in 27 suites; build and ESLint passed. All original E2E assertions
were preserved; only the five relative import paths changed. Verification used
an environment-free temporary copy and disposable MongoDB.

Live SCRUM-21 and `docs/contracts.md` v1.3 were checked. The official university
workbook and latest project description were not accessible in this checkout;
their text was not independently verified. A future PR must reference GEN-07 and
complete the shared PR checklist. No PR is created by this task.
