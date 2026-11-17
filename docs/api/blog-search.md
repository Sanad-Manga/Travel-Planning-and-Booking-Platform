# Blog search (BLG-09)

`GET /api/posts?q=cairo%20food&page=1&limit=10` (public, no login). It is the BLG-02 list with an optional keyword `q`.

| Query | Rule |
|---|---|
| `q` | Optional, at most 100 characters (400 above), trimmed. A blank `q` means no search. |
| `tag` | Optional (BLG-02). Combines with `q`: both must match. |
| `page`, `limit` | Shared pagination, default 10 per page, at most 50. |

## What matches

The keyword is split into words. **Every word** must appear, case-insensitive and as plain text (a keyword such as `c++` or `(` is never a regular expression), in at least one of:

- the post **title**,
- one of its **tags**,
- the **author's name** (read from the `users` collection in the same aggregation, read only).

The body is not searched. Only `PUBLISHED`, not hidden posts are searched, so drafts and hidden posts never appear, not even for their author.

## Order

With `q`: **likes + comments** (`likeCount + commentCount`) descending, then newest published first (`publishedAt`, falling back to `createdAt`), then `_id` so pages never repeat a row. Without `q` the list keeps its BLG-02 order (newest published first).

## Rows

`id`, `title`, `author { id, name }`, `tags`, `publishedAt`, `excerpt`, `likeCount`, `commentCount`. The `excerpt` is the first 150 characters of the body with whitespace collapsed and a trailing `…` when it was cut. It is on every row of `GET /api/posts` and `GET /api/tags/:tag/posts` (a new field, nothing removed). No full body, no images.

No match is `200` with `{ "items": [], "page": 1, "limit": 10, "total": 0, "totalPages": 0 }`.

## Known limits

- Substring matching cannot use an index, so a search reads the published posts. Fine at this scale; a text index would be the next step.
- Posts of a `DEACTIVATED` author are still listed and searchable by name, exactly like BLG-02 today (see the "Posts" row in `account-deactivation.md`, which is a separate item).
