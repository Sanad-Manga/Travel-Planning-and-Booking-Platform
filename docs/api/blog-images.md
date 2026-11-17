# BLG-10 / SCRUM-78 — Post image attachments

Current corrected review copy: `feature/BLG-10-post-images-integrated` on
`89feebcc2a13bc8d12bf689202b24f2bdf246245`. Student-authorized implementation;
explicit Yusuf/Ahmed approval is not independently verified and review is pending.

Original implementation on `feature/BLG-10-post-images` from fetched `origin/develop`
`4bd25ed940224a1d64c68db2166b1c45b610b954` (2026-11-17). The existing Post
schema and `{ id, url }` image response shape are unchanged. One focused Blog
controller/service integrates the existing UploadsModule; no new storage,
collection, dependency, global guard or AppModule registration is introduced.

## Endpoints

### POST `/api/posts/:id/images`

Send one JPEG/PNG in multipart field **`image`** with the normal access cookie.
Multer buffers in memory (no disk destination or module-level disk override),
limits files to one, bytes to 5,242,880, and rejects text/extra file fields. The
service checks the parent and its authenticated author before shared storage is
called. All existing authenticated author roles can manage their own posts;
ADMIN receives no special access to somebody else's attachments. Draft and hidden
posts remain editable by their author.

The shared UploadService validates nonempty bytes, size, MIME/signature agreement
and complete image decoding, then reserves one of five slots. The target is
`{ kind: 'post', ownerId: postId }`, never the caller's user ID. The Blog update
also conditionally requires fewer than five references and no duplicate ID; a
legacy/unmanaged reference still counts toward the Post limit.

Success is **201** with exactly:

```json
{
  "id": "6730a1f2c3d4e5f607182931",
  "url": "/uploads/6730a1f2c3d4e5f607182931.png"
}
```

The corresponding reference is persisted and still appears in the existing
post response DTOs. Resolve the URL against the backend origin, without `/api`.
File names and supplied paths are ignored; JPEG files use `.jpg`.

### DELETE `/api/posts/:id/images/:imageId`

The service authorizes the post, checks image membership, then calls
`UploadService.removeForTarget(id, { kind: 'post', ownerId: postId })` before an
atomic `$pull` matching author and image ID. It never replaces the entire array.
Success is **204**, with no body. A sequential repeat is **404**; overlapping
deletions may produce one 204 and one 404. Missing physical files/metadata are
safe to retry. Foreign/unmanaged legacy references can be detached without
deleting another entity's file; malformed/non-ObjectId image IDs return 404.

## Errors

All errors use the global filter's statusCode/error/message/path/timestamp shape.

| Situation | Status |
| --- | --- |
| Missing, inactive, invalid or invalidated authentication | 401 |
| Authenticated forced-password-change session | 403 (existing global guard) |
| Unknown/malformed/other-author post | 404 |
| Missing/empty/unsupported/corrupt/mismatched image, extra multipart fields/files | 400 |
| File exceeds the interceptor byte limit | 413 |
| Five-image capacity exhausted or concurrent attachment change | 409 |
| Missing/malformed/unassociated/already-removed image | 404 |
| Infrastructure failure or uncertain attachment acknowledgement | Sanitized 500 |

Errors and logs contain no binary payloads, filesystem paths, connection strings,
driver diagnostics, cookies or JWTs. Reconciliation warnings contain only
normalized post/upload IDs and a fixed diagnostic message.

## Student-authorized compatibility changes — owner/lead review pending

The student authorized implementation of the decisions below. This is not independently verified approval from Yusuf/Ahmed. Changes affecting the Blog API and the shared UploadService remain subject to code-owner/lead review before integration:

- Create permits omitted `images` or `images: []`; nonempty direct references
  return field-level 400. PATCH rejects every supplied `images` field, including
  `[]`/null. Existing fields remain in the DTO for explicit deprecation and
  response compatibility; title/body/tags/status edits retain their behavior.
- New attachments and removal go through the image endpoints. An attacker cannot
  borrow another upload ID, invent a URL, bypass decoding or reintroduce a file
  while deletion is in progress through ordinary create/PATCH requests.
- Additive `removeForTarget` keeps `save`/`remove` unchanged and uses the existing
  upload metadata/state/recovery infrastructure. It verifies kind/parent ID
  atomically and ignores foreign metadata. The Post schema is not modified.
- Post deletion first cleans its snapshot of managed images, then conditionally
  deletes only if the images still match that snapshot. New concurrent images
  yield 409/retry, preserving their parent and files. An upload that loses its
  parent before attaching compensates its known unattached file. The original
  comments/likes cascade follows deletion as before.

The two existing create/edit E2E assertions for client-supplied references were
updated to test this student-authorized stricter behavior. Other assertions remain intact.

## Failure/recovery behavior and limitations

MongoDB and local files are not one transaction. This integration does not add a
new queue, journal, schema, distributed transaction or background architecture.

- A definite attachment non-match safely removes its unique newly saved file
  through scoped cleanup. If that cleanup fails after deletion state is durable,
  existing upload recovery retries it. Pre-marking failures may require manual
  retry; the fixed warning records the post/upload IDs.
- A thrown attachment update has an ambiguous outcome. If a primary follow-up
  read finds the reference, return the successful reference and keep its file.
  Otherwise return 500 and **retain** the ready file: an absent read cannot prove
  a delayed write will never commit. Ready files are not auto-expired by the
  shared service. An operator must reconcile the logged IDs with Post references
  and outstanding writes before deleting an unreferenced owned upload. Do not
  automatically retry an ambiguous attachment as if it certainly failed: a
  fresh request creates a fresh ID and may consume another slot.
- Image removal keeps the reference until scoped file cleanup succeeds. A disk
  failure leaves `deleting` metadata for upload recovery and returns 500. Recovery
  may remove the file before the client retries; the reference can temporarily
  point to a missing file. Retry the same DELETE to finish the `$pull`.
- Concurrent unlink can produce Windows `EPERM` when another worker has already
  removed the generated path. Storage treats it as completed only after `lstat`
  confirms `ENOENT`. Permission errors for existing or unreadable files still
  fail and preserve recovery metadata. This is a narrow idempotency correction,
  not a permission bypass or a new recovery subsystem.
- If unlink succeeds but `$pull` fails, return 500; the retained reference is the
  retry handle. If the pull actually committed despite an error, a later retry
  returns 404 and the final file/reference state is already consistent.
- Post deletion keeps the parent/references until its cleanup succeeds. A crash,
  DB error or concurrent image change after unlink can leave broken references
  on the still-existing post. Retry post deletion to converge. The existing
  nontransactional comments/likes cascade is unchanged. No ready upload is
  deliberately discarded solely on an uncertain attachment outcome.
- **Image URLs are public even for draft/hidden posts.** This pre-existing documented
  UploadService limitation is not fixed by author-only mutation endpoints.
  Original bytes/metadata are not stripped. Persistent/shared deployment storage
  and backups remain requirements of GEN-08; see its README.

## Review and acceptance evidence

`backend/test/blog-images.e2e-spec.ts` runs the actual AppModule/global guards,
real shared uploads/Sharp/filesystem, disposable MongoDB and temporary storage.
The HTTP adapter is supplied during compilation exactly as the existing upload
test does, enabling real static serving. Controlled spies inject failures and
race timing; they do not replace normal authorization, persistence or validation.

Coverage includes real JPEG/PNG/URL bytes; missing/empty/corrupt/oversized and
MIME mismatch cases; extra fields/files; author/guest/other-user/ADMIN boundaries;
five/six/concurrent capacity; legacy reference capacity and foreign-file safety;
known non-match compensation and uncertain/committed acknowledgement behavior;
storage failures/recovery and Post-pull retry; concurrent upload/removal;
create/PATCH bypass rejection; post CRUD/visibility and deletion races; actual
Swagger. Shared upload integration also checks scoped cross-kind/parent safety
without changing existing save/remove assertions.

Focused verification: the initial Blog/upload unit/integration run passed 74/74
tests (five suites); post/upload HTTP regressions passed 47/47. After diagnosing
the Windows unlink race, shared upload tests passed 39/39 (including deterministic
absent-path and genuine-permission-error cases), and the BLG-10 HTTP suite passed
32/32, including 20 overlapping same-image delete iterations. The lost-ack test
wrapper's original TypeScript overload error was fixed with typed argument
forwarding, without type-check suppression. No assertions were weakened.

The first full E2E run exposed the unlink race (204/500 instead of 204/404). It
was diagnosed with filesystem error codes only, not binary/path logging. Full
verification was rerun sequentially because the correction affects shared storage.

## Previous verification on the original baseline (2026-11-17)

| Check | Actual result |
| --- | --- |
| Initial focused Blog/upload Jest | 74/74 passed, five suites |
| Focused shared upload after Windows correction | 39/39 passed, two suites |
| New real-AppModule image HTTP tests | 32/32 passed, including 20 same-image deletion races |
| Existing post/upload HTTP regressions | 47/47 passed |
| Latest full Jest | **1,013 passed, one failed**, 64 suites / 1,014 tests; unrelated live-FX failure below |
| Unchanged failing itinerary suite, one focused retry | 21/21 passed |
| Final full E2E | **1,239/1,239 passed**, 47 suites |
| TypeScript build | Passed |
| Full ESLint | Passed |

The original-baseline full-Jest failure was ITN-21's existing clone-budget comparison:
`FxService` attempted a real provider fetch without cached rates and received
an unavailable-rates error for USD. Its fixture does not override the live FX
provider. No FX/itinerary code was changed. Mohamed explicitly chose to leave
that unrelated test unchanged and report the result. A single unchanged-suite
retry passed all 21 tests, confirming the transient outcome. This is **not** a
claim of success for that original full-Jest command. The live-provider dependency remains unchanged; deterministic fixture work belongs to that owner. Current integration verification is recorded below.

Full E2E emitted server listener-limit warnings; they were not suppressed. All
checks used existing installed dependencies in an environment-free temporary
copy, synthetic accounts, temporary upload storage and disposable MongoDB. No
Atlas, real `.env`, production credentials, dependency installation, commit,
push, merge/rebase, PR creation or Jira edit was performed. Logs remain outside
the repository. Final tracked/new-file whitespace checks passed, no unresolved
conflicts or unrelated changes were found, and all changed TypeScript hashes
match the verified copy. The AI prompt entry was appended without deleting history.

## Jira/PR checklist evidence

The live Jira issue was read without modification. Its description's instruction
to add an array predates the existing Post schema: the existing Yusuf-owned
`images` field is reused, not duplicated. The student authorized the API compatibility and scoped-cleanup/deletion implementation. Explicit teammate approval has not been independently verified; Yusuf/Ahmed review is pending before integration.

| Jira checklist item | Evidence/status |
| --- | --- |
| Wrong type, over 5 MB and sixth image rejected | Actual decoding/MIME/size/capacity HTTP cases, including exact size boundary and concurrent/legacy count cases |
| Only author may attach/remove | Service filters plus real guard/ownership tests for guests, other users and ADMIN |
| Removal removes file reference | Atomic pull and actual metadata/file/URL assertions, including concurrent operations and failure retries |
| Post schema field agreed with Yusuf | Existing PostImage/images representation unchanged; student-authorized integration decisions await owner/lead review |
| Swagger, BLG-10 PR name and shared checklist | Actual AppModule Swagger checked for both endpoints, auth, multipart, parameters, response and error categories. Suggested eventual title: `feat(blog): attach and remove post images (BLG-10)`. No PR or publication checkbox was created/ticked |

Shared-checklist technical evidence: shared enums/validation/errors/constants and
uploads are reused; ownership is service-side; multipart shape/limits and direct
reference restrictions are explicit; array updates are conditional and race
tested; responses exclude storage metadata; only student-authorized Blog/shared-signature
changes were made. Production Post schema, auth/guards, AppModule, dependencies
and unrelated modules remain unchanged. Tests, error diagnosis, non-atomic
limitations, compatibility decisions/review status and AI assistance are documented. Full-Jest
flakiness is explicitly recorded rather than claiming every repository check is
green. Independent review precedes any authorization to commit or publish.

## Independent-review correction and upstream integration

The corrected implementation resides on local review branch
`feature/BLG-10-post-images-integrated` at
`C:\my projects\Travel-Planning-and-Booking-Platform-BLG10-integrated`, based
on latest fetched `origin/develop` `89feebcc2a13bc8d12bf689202b24f2bdf246245`.
The original branch/worktree at
`C:\my projects\Travel-Planning-and-Booking-Platform` remains unchanged at
`4bd25ed940224a1d64c68db2166b1c45b610b954`, including its 16 uncommitted files.
All 16 files were backed up and SHA-256 verified outside the repository before
creating the integration worktree; the tracked patch alone was not the backup.

The upstream base includes ACC-15 (`67363c1`), BLG-09 (`26beea7`), FLT-12
(`4668b5a`), HTL-02 (`db6711a`) and HTL-08 (`89feebc`). A three-way tracked patch
plus verified copies of all four untracked files transferred BLG-10. The sole
text conflict was the Blog service import block: retain upstream ProjectionType,
default pagination and toPaginated imports, and remove the image-limit import
that BLG-10 no longer uses there. Search aggregation, excerpts, pagination,
keyword/tag filtering and ordering are retained unchanged from upstream.
Blog controller hunks merged cleanly; both AI prompt histories were retained.
No newer teammate implementation was replaced with an old whole-file copy.

The earlier BLG-10 AI entry claiming that the student explicitly confirmed
Yusuf/Ahmed approval is retained as historical text and cross-referenced by an
appended correction. Student authorization is not independently verified teammate
approval. Blog API/shared-service decisions require Yusuf/Ahmed review before
integration; no review approval is invented here. Other tickets' historical
approval statements are untouched.

Deletion comments now describe load/snapshot, scoped cleanup, conditional parent
delete, then comments/likes cleanup, including retry/non-atomic limitations.
Create/PATCH Swagger descriptions explicitly state the image-input policy;
create's deprecated input schema has maxItems zero while response image shapes
remain unchanged. These are comment/Swagger corrections, not deletion or upload
algorithm changes.

## Corrected integration verification (2026-11-17)

Commands ran sequentially from the corrected integration worktree's backend,
using existing installed dependencies through a junction. No backend .env file
was present. Default upload storage and all test logs were redirected to a unique
external temporary directory; HTTP fixtures additionally use their own temporary
storage and disposable MongoDB. No dependency reinstall or Atlas access occurred.

| Check | Current integration result |
| --- | --- |
| Focused Blog/upload unit/integration | 85/85 passed, 6 suites; includes the upstream search-row tests |
| Focused HTTP: images, CRUD, search, comments, uploads | 119/119 passed, 5 suites; includes all 32 BLG-10 cases and 20 overlapping-delete iterations |
| Full Jest | 1,051/1,051 passed, 68 suites |
| Full E2E | 1,346/1,346 passed, 51 suites |
| TypeScript build | Passed |
| Full ESLint | Passed |

The historical live-FX failure did not recur in this run; no itinerary test or
production FX code was modified and no external-provider behavior was mocked to
obtain a green result. The external dependency can still make future runs flaky.
Full E2E emitted server listener-limit warnings without suppression; no suite
failed or assertion was removed/skipped. Earlier original-baseline results above
remain historical rather than being relabeled as successful.

Source-preservation checks compared TypeScript method bodies: BLG-10 create,
update, remove and deletePostAndDependents bodies are unchanged from the verified
backup; upstream listPublished/searchPublished/listByTag bodies are unchanged
from the latest base. Both complete image/upload service files and the Windows
storage fix are preserved. Post schema, authentication, Flight/Hotel/Payments/
Itinerary implementation and unrelated teammate tests have no diff against the
new base. Both AI histories' content is retained; upstream's own removal of one
formatting separator was kept. No functional integration conflict remains.

The original working tree remains the recoverable snapshot and still contains
its historical review findings. Review the corrected integration worktree, not
the preserved original copy. The backup is at
`C:\Users\COMPUMARTS\AppData\Local\Temp\blg10-review-backup-7fd85aafa0bc476d9c2ddf6328e064cf`.
Owner/lead review of the Blog API compatibility choices and additive UploadService
method is still required before integration. Public draft/hidden image URLs,
ambiguous attachment reconciliation, interrupted-deletion retry windows and
nontransactional filesystem/MongoDB/comments/likes limitations remain unchanged.

Final Git/source checks passed: the integration diff contains exactly the intended
16 paths, no conflict markers/unmerged entries or environment/credential files,
and no unrelated implementation changes. The complete corrected snapshot is
staged but uncommitted (12 modified, 4 added). The original still has its exact
12 unstaged modifications and 4 untracked files; all original and backup SHA-256
hashes, original HEAD/branch/status and both prompt histories were verified.
Exact status captures and verification logs are outside both source trees at
`C:\Users\COMPUMARTS\AppData\Local\Temp\blg10-integrated-verification-9950059e43464e47ab17fbfb558fff27`.
No commits, pushes, branch merges, rebases, PRs, Jira edits or destructive cleanup
were performed. Review the full integration change with `git diff HEAD` (the
index also contains the complete snapshot); owner/lead review remains pending.
