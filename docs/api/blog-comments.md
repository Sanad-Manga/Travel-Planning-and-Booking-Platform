# Blog comments: edit and delete (BLG-07)

Comments are created and listed under `/api/posts/:id/comments` (BLG-05). BLG-07 adds two routes addressed by the comment id.

| Route | Success | Body |
|---|---|---|
| `PATCH /api/comments/:id` | 200, the updated comment | `{ "body": "..." }`, the same rules as creating a comment (`UpdateCommentDto` extends `CreateCommentDto`: trimmed, not empty, at most `COMMENT_MAX_LENGTH` = 500, unknown fields rejected) |
| `DELETE /api/comments/:id` | 204, no body | none |

Both need a logged-in user. Any role may edit or delete **their own** comments.

## Who may do what (checked in `CommentsService`, not the controller)

| Case | Result | Why |
|---|---|---|
| Malformed or unknown id, or the post is deleted, a draft or hidden | 404 `Comment not found` | Same post rule as creating and listing comments (BLG-05): only a published, not hidden post has reachable comments. Deleting a post already deletes its comments. |
| Someone else's visible comment (any role, including ADMIN, the post author and moderators) | **403** | A comment is public content, so there is nothing to hide: contracts section 4 reserves 404 for resources private to their owner. Admin removal of others' comments is GEN-10, not these routes. |
| Someone else's comment that a moderator hid | 404 for non-admins (a hidden comment is visible only to its author and admins, so its existence is not revealed); 403 for an admin | `isHidden` semantics of contracts section 7 |
| Own comment that a moderator hid, `PATCH` | **409** | The author cannot change content under moderation, and nothing here can clear `isHidden`. |
| Own comment that a moderator hid, `DELETE` | 204 | The author may always withdraw their own content. |

## Delete is a hard delete

Like deleting a post (BLG-04) the comment document is removed. `Post.commentCount` counts every stored comment, hidden or not (BLG-05 increments it on create), so delete decrements it by one **in the same MongoDB transaction** (guarded by `commentCount > 0`). A second delete of the same comment is a 404 and does not decrement again.

An edit changes only `body` (and so `updatedAt`). `authorId`, `postId`, `isHidden` and `createdAt` never change.
