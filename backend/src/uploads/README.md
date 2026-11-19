# GEN-08 / SCRUM-22 — Image upload service

This module provides server image storage for FLT-01, HTL-01, ITN-12 and BLG-10.
It exports `UploadService` through `UploadsModule`. It adds visibility-checked image GET/HEAD
serving at `/uploads/`, but no standalone upload POST or DELETE endpoint.

## Contract and integration

```typescript
save(file: UploadFile, target: UploadTarget): Promise<{ id: string; url: string }>
remove(id: string): Promise<void>
removeForTarget(id: string, target: UploadTarget): Promise<void> // deletes only if stored for that kind/ownerId, else no-op
```

`UploadFile` accepts a buffered Multer file: `{ buffer, size, mimetype }`.
Other Multer properties may be present; filenames and supplied paths are ignored.
`UploadTarget` is `{ kind, ownerId }`. The exported `UploadKind` values are
`'post' | 'activity' | 'hotel' | 'airline'`. **ownerId is the target entity ID,
not the authenticated user's ID.** IDs are 1–100 ASCII letters/digits/underscore/
hyphen, starting with a letter or digit; 24-character hex ObjectIds are normalized
to lowercase. Target existence and permissions belong to the consumer.

```typescript
import { Injectable, Module } from '@nestjs/common';
import { UploadsModule, UploadService, UploadFile } from '../uploads';

@Injectable()
class ActivityImagesService {
  constructor(private readonly uploads: UploadService) {}

  async storeAuthorizedActivityImage(file: UploadFile, activityId: string) {
    // The real consumer first authenticates, loads the activity and checks ownership.
    const reference = await this.uploads.save(file, {
      kind: 'activity', ownerId: activityId,
    });
    // Persist reference on the activity; compensate with remove(reference.id)
    // if that write fails. Do not accept arbitrary client-provided references.
    return reference;
  }
}

@Module({ imports: [UploadsModule], providers: [ActivityImagesService] })
class ConsumerModule {}
```

The consumer must authenticate and authorize **before** calling save/remove.
For deletion, load the parent, check ownership/role, and find the requested file
ID among that entity's stored references before calling `remove(id)`. The fixed
contract has no principal and cannot enforce these checks itself. Interceptors
should use memory storage and constrain request size/files as an early resource
limit; the service independently revalidates the input.

## Validation and limits

Shared `common` constants enforce JPEG/PNG, at most **5,242,880 bytes (5 MiB)**,
five images per post/activity/hotel and one logo per airline. Capacity exhaustion
returns 409. Invalid/missing files, MIME mismatches, malformed IDs/kinds and
undecodable images return 400. Multipart interceptors may reject oversized
requests with 413 before they reach the service.

The service verifies PNG/JPEG signatures and MIME agreement, copies the buffer,
then uses **Sharp 0.35.5** to inspect format and force pixel decoding. Signature
checks alone cannot reject corrupt image payloads. Sharp aborts on decoder
warnings, limits input to 20 million pixels and bounds pixel processing to five
seconds. Original bytes are stored after validation: no resizing, conversion,
metadata stripping or lossy re-encoding is performed. Metadata and otherwise
valid trailing data are not sanitized. This is image validation, not antivirus
scanning. Consumers should also limit simultaneous incoming requests.

Sharp is the only new direct dependency; its native/platform dependencies are
recorded in the lockfile. **Ahmed: review the decoder addition in the PR.**

## Storage, URLs and privacy

Default storage is `resolve(process.cwd(), 'uploads')`; run the backend from
`backend/` to use:

```text
backend/uploads/staging/   # private, incomplete files
backend/uploads/public/    # validated, complete files
```

Module-local `UPLOAD_STORAGE_ROOT` can point to a dedicated absolute persistent
storage directory. Tests override the `UPLOAD_OPTIONS` provider with an isolated
temporary directory. No shared configuration or `.env` change is required.
Do not point this setting at a directory containing unrelated public files.
The application process needs read/write access; untrusted processes must not
have write access to the storage root or its parent directories.

Generated ObjectIds determine filenames, e.g. `<id>.png`; owner IDs and original
filenames never become paths. Exclusive staging writes precede same-filesystem
rename. Configured root/staging/public symlink directories are rejected, and
metadata is checked against the exact ID/extension before file deletion.

Returned URLs are backend-origin relative, e.g. `/uploads/<id>.jpg`, **without
`/api`**. The frontend resolves them with its backend origin, or deployments proxy
`/uploads/` to the backend. `FRONTEND_URL` is not used as a backend public address.
Only `public/` is served by `ServeStaticModule`, with no directory index, hidden
files or SPA fallback; images use `X-Content-Type-Options: nosniff`.

Blog images now follow the GH-116 policy below. Hotel images, airline logos and
itinerary activity images retain their existing public visibility; this fix does
not introduce private-itinerary image authorization. Unguessable IDs are not
access control. Final Ahmed/Yusuf approval of the Blog privacy policy is pending.

Local storage requires a persistent deployment volume and coordinated backups
of files and MongoDB. Multiple server instances need the same shared filesystem;
MongoDB coordination does not replicate local files. Ephemeral disks lose images.

## Capacity, failures and recovery

`uploadedFiles` stores entity kind/ID, capacity slot, active/state flags, lease,
generated storage key, verified content type/size and Mongoose timestamps.
A unique partial index on `{ kind, ownerId, slot }` with `active: true` reserves
each slot atomically. The application creates the required indexes before
accepting requests. It does not count records and then insert. Two instances
competing for the final slot cannot both succeed. New attempts use new file IDs.

Lifecycle:

1. Validate and decode before reserving.
2. Reserve one permitted slot as pending, with a 60-second MongoDB-clock lease.
3. Write staging and publish the complete file by rename.
4. Conditionally mark the still-live reservation ready; only then return its URL.

Writes/deletes reject with fresh sanitized 500 exceptions on infrastructure
failure. Raw filesystem paths, driver diagnostics and causes are not forwarded.
No blind retry creates duplicate uploads. On write failure, only a still-pending
reservation can be retired for cleanup. If ready acknowledgement was lost, the
service may reject while leaving a committed upload intact; it never deletes
that committed record as compensation.

An internal unreferenced timer checks recovery every 30 seconds, also running at
startup. Expired pending reservations are atomically retired and release capacity.
Old writers cannot finalize them or overwrite replacement filenames. Cleanup
and deletion records are retried in batches of 50; failed items move to the back
of the work queue. Generated orphan files older than a lease, with no metadata,
are reconciled in bounded batches. Directory names are enumerated per scan;
consider an indexed filesystem inventory if storage grows substantially. There
is no external queue, TTL deletion of ready uploads or shared scheduler change.

`remove(id)` resolves metadata, marks a ready file deleting, unlinks its generated
files, then deletes the metadata to release capacity. Unknown well-formed IDs
and repeated deletes succeed; malformed IDs return 400. Missing physical files
are treated as already deleted. A disk failure retains deletion state/capacity;
DB failure after unlink is safely retried. Pending IDs have not been returned to
consumers and are reclaimed by the lease recovery path.

MongoDB and the filesystem are not an atomic transaction. Cleanup can be delayed
while either is unavailable; recovery converges when service is restored.
Publication precedes the ready acknowledgement, so a validated but uncommitted
file can temporarily exist on disk. The GH-116 gate denies non-ready metadata;
Blog files also require an actual parent attachment before serving. Ready uploads
whose caller failed to attach them are not automatically expired: the upload
service cannot infer consumer references. Consumers must handle attachment
compensation and reconcile ambiguous outcomes. Replacing a full entity's image
requires removing an existing image first; atomic replacement is not provided.

## Owner-managed integrations

- **Ahmed / airlines:** existing `logoUrl` accepts HTTP(S) only and has no stored
  upload ID. Update that stub in the airline-owned integration; relative returned
  paths are currently incompatible with its DTO.
- **Yusuf / hotels and blog:** existing `{ id, url }` arrays accept these relative
  paths. Add authorized multipart endpoints, trusted attachment, removal and
  cleanup when entities are deleted/references replaced.
- **Yassin / itineraries:** activity schema and ITN-12 image integration remain
  itinerary-owned work. Authorize through the activity's parent itinerary.
- Existing unmanaged IDs/URLs are not automatically registered, counted or
  deleted by this service. No consumer modules were modified.

## Tests and verification

All tests use temporary directories, synthetic accounts and disposable MongoDB;
dotenv is mocked and root E2E ConfigModule environment-file loading is disabled.
Never point tests at shared Atlas or use an actual administrator account.

- `image-validation.spec.ts`: generated real JPEG/PNG, exact size boundary,
  corrupt/disguised formats, MIME mismatch, empty/malformed input, pixel cap.
- `upload.integration.spec.ts`: actual metadata/files, all entity limits,
  independent service instances racing for capacity, durable failure handling,
  ambiguous acknowledgement, stale workers, orphan recovery and safe deletion.
- `backend/test/uploads.e2e-spec.ts`: real AppModule and consumer DI, returned
  public URL and bytes, normal auth/ownership errors through a **test-only**
  multipart endpoint, static-directory protection and error sanitization.

The E2E fixture supplies ExpressAdapter during module compilation, matching
NestFactory startup: ServeStatic selects its HTTP loader at provider creation.
Compiling before creating an adapter otherwise selects its no-op loader.

Normal commands from an environment-free backend verification copy:

```powershell
npm test -- --runInBand src/uploads
npm run test:e2e -- --runInBand uploads.e2e-spec.ts
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build
npm run lint
```

E2E tests live under `backend/test/` and are discovered by the standard E2E
configuration, including CI. Scripts and Jest configuration are unchanged.

Verified on 2026-11-06 in an environment-free temporary backend copy: focused
upload tests 36/36, focused E2E 7/7, full Jest 502/502 (34 suites), standard full
E2E 236/236 (14 suites), build and ESLint all passed. A clean lockfile install
passed with the redundant MongoDB-binary postinstall download disabled; tests
used the existing MongoDB 8.2.6 binary to start disposable instances. No existing
locked package versions changed. All GEN-08 whitespace checks passed; the
repository-wide check separately reports a pre-existing final blank line in
AI_PROMPTS.txt, which was deliberately left untouched under the task restriction.

## GH-116 — Blog image visibility (local implementation; policy approval pending)

Previously, Blog API authorization did not cover ServeStatic's `/uploads/` route:
a draft post returned 404 to anonymous callers while its image returned 200.
The production-AppModule regression reproduced that leak before this change.

`UploadsModule.configure()` now mounts one root `/uploads` middleware before
ServeStatic's `onModuleInit` registration. ServeStatic remains the sole file
server; there is no replacement controller or second public route. Authorization
finishes before static GET/HEAD, ETag/Last-Modified or range handling. Failures are
finished through the existing error formatter because ServeStatic's own excluded-
route error handler would otherwise replace forwarded failures with 404.

Every request requires a canonical generated filename and matching ready, active
upload metadata. Blog metadata must identify an existing Post whose `images`
contains the same ID and canonical URL. Missing/deleted parents, unattached
images, invalid metadata and non-ready records return a nondisclosing 404.

| Blog state | Public | Author | Non-author ADMIN |
|---|---|---|---|
| PUBLISHED, not hidden | Yes | Yes | Yes |
| DRAFT | No | Yes | No |
| PUBLISHED, hidden | No | Yes | Yes |
| Missing/deleted parent or missing attachment | No | No | No |

Private access invokes the unchanged `JwtAuthGuard`, wired with the existing
`UsersService`, `Reflector`, official `readJwtSecrets` helper and HS256 options.
No JWT/session verification logic is copied. The guard verifies the access cookie,
signature, expiry, claims, ACTIVE account, credential version and forced-password-
change restriction. The image context has no public/forced-change exemption.
Invalid credentials return 404; public images do not require a valid cookie.
Refresh cookies do not authenticate image requests. Logout retains the project's
existing semantics: revoking a refresh token does not independently revoke an
already-issued access token before expiry or credential-version invalidation.

URLs remain `/uploads/<id>.jpg` or `.png`, without `/api`. Authorized requests
retain JPEG/PNG MIME, exact bytes, HEAD, conditional/range responses and nosniff.
Noncanonical encodings, separators and traversal aliases are rejected. Hotel,
activity and airline ready uploads retain public GET/HEAD and caching behavior.
No attachment/removal endpoints, limits, schemas, storage or recovery logic changed.

Metadata, Post or account-state lookup failures return a sanitized 503 without
serving bytes or mutating metadata/files; fixed-stage diagnostics identify the
image for retry. Missing metadata returns 404. This deliberately trades upload
availability for privacy: all upload kinds require metadata availability. Each
request adds one indexed upload lookup, Blog requests add a Post lookup, and
private Blog requests also use the guard's account lookup. No authorization cache
is used. A decision applies when checked; an already-authorized in-flight transfer
cannot be recalled after a concurrent visibility change.

All Blog responses use `Cache-Control: no-store` and `Vary: Cookie`, including
permitted partial/conditional responses. Subsequent unauthorized conditional or
range requests return 404 before the file server. Previously downloaded copies
cannot be revoked. Deployment must route `/uploads` through Nest, never directly
through a public filesystem/CDN origin. Purge any previously cached Blog images
and ensure proxies respect no-store; application changes cannot invalidate old
external caches retroactively.

`backend/test/upload-visibility.e2e-spec.ts` uses the actual AppModule, real static
routing, disposable MongoDB, synthetic accounts and temporary files. It covers
the policy for GET/HEAD, invalid/stale/forced/inactive authentication, visibility
transitions, metadata failures, missing files, JPEG/PNG, conditional/range and URL
bypass attempts, plus real shared UploadService fixtures for all public kinds.
The GEN-08 public fixture now uses `hotel` rather than an unattached synthetic
`post`; its existing assertions are preserved. Standard Jest/E2E configuration
and scripts are unchanged.

The student authorized this local proposed fix. GH-116 had no owner comments
when checked; Ahmed and Yusuf's final privacy-policy approval remains pending.
Local verification does not authorize merging or establish team approval.

Verified 2026-11-18/19: focused E2E 148/148 (6 suites), focused Jest 111/111
(8 suites), full Jest 1,141/1,141 (78 suites), standard full E2E 1,496/1,496
(58 suites), build and full ESLint passed. Privacy E2E: 67/67, including 14
explicit authentication/spoofing cases and 3 public consumer-kind cases.
Existing shared uploads: 37/37 Jest and 7/7 E2E; BLG-10 E2E: 12/12;
auth E2E: 24/24; itinerary activity images: 13/13 Jest. Full E2E emitted
MaxListenersExceededWarning messages during existing suites; no tests failed.
Lint initially flagged computed-property line breaks in the new test; a small
request helper fixed them. The affected privacy suite was rerun (67/67) after
that test-only cleanup; production code was unchanged after the full runs.
No dependencies were installed, real environment files read, or shared Atlas
connections made. Team policy approval remains pending.
