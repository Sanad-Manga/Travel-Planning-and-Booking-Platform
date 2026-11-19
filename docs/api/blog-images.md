# Blog post images (BLG-10)

Owner: Mohamed Walid. Uses the shared `UploadService` (GEN-08) and the existing `Post.images` field (BLG-01, `{ id, url }[]`, no schema change).

## Endpoints

| Method | Path | Who | Result |
|---|---|---|---|
| POST | `/api/posts/:id/images` | the post's author | `201 { id, url }` |
| DELETE | `/api/posts/:id/images/:imageId` | the post's author | `204` |

**POST** takes `multipart/form-data` with one file in the field `image`.

| Case | Status |
|---|---|
| Not logged in | 401 |
| Unknown/malformed post id, or someone else's post | 404 |
| No file, not JPG/PNG, not a real image, empty file | 400 |
| File larger than 5 MB | 413 |
| The post already has 5 images | 409 |

**DELETE** answers 404 when the post is unknown or someone else's, or the image is not on that post. The stored file is deleted first, then the reference is pulled. Both steps are safe to repeat, so a failure in between can be retried.

## How it works

- The ownership check (`_id` + `authorId`) is in `PostImagesService`, as in ITN-12 (activity images).
- `UploadService.save()` validates the file and enforces the 5-image limit with one numbered slot per image. Two uploads for the last place can't both win (one 201, one 409). If pushing the reference fails, or the post was deleted in between, the stored file is removed again.
- Removal uses `UploadService.removeForTarget(id, { kind: 'post', ownerId })`. It deletes a file only if it was stored for this post. Before BLG-10, a post could hold any image reference the client sent; for those, only the reference is pulled, and nobody else's file is touched.

## Changes to BLG-01 / BLG-04 (agreed with Yusuf)

- `images` is no longer accepted in `POST /api/posts` or `PATCH /api/posts/:id`. The global whitelist answers 400 with `details: [{ field: 'images', ... }]`. Images can only come from the upload endpoint.
- Deleting a post (`DELETE /api/posts/:id`, and the admin delete that reuses `deletePostAndDependents`) also deletes its image files, best effort after the post is gone. A file that could not be deleted is retried by the upload service.

## Image visibility — GH-116

Local implementation follows the proposed policy; Ahmed/Yusuf's final approval
is still pending. POST/DELETE behavior above is unchanged.

`/uploads/<id>.jpg` and `.png` are checked before static GET/HEAD serving:

- Published and not hidden: public, including requests without authentication.
- Draft: author only; a non-author admin is denied.
- Published and hidden: author or admin.
- Deleted/missing parent or image not actually attached: denied for everyone.

Private requests reuse the complete existing JwtAuthGuard, including ACTIVE
account, credential-version and forced-password-change checks. Invalid/missing
access credentials return a nondisclosing 404. Refresh cookies are not access
credentials; existing logout/access-expiry semantics are unchanged.

Missing upload metadata returns 404. Failed upload/Post/account reads return a
sanitized 503 without image bytes or metadata deletion. Non-Blog ready uploads
remain public, but metadata availability is required for every upload kind.

Blog images use `Cache-Control: no-store` and `Vary: Cookie`. Authorization also
precedes HEAD, conditional and byte-range handling. Already downloaded images or
transfers authorized before a concurrent visibility change cannot be recalled.
Deployments must proxy `/uploads` through Nest and purge old CDN/proxy caches;
this fix cannot invalidate externally cached copies. See the upload README for
integration tests, performance implications and deployment details.
