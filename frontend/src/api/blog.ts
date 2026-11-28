import { api } from '@/lib/api';
import { withQuery } from './types';
import type { QueryOf, ResponseOf, Schema } from './types';

/** Blog endpoints (BLG-02, BLG-08, BLG-09). One function per endpoint, as in `referenceData.ts`. */

export type PostListRow = Schema<'PostListRowDto'>;
export type PostsPage = ResponseOf<'/api/posts'>;
export type PostsQuery = QueryOf<'/api/posts'>;
export type TagPostsPage = ResponseOf<'/api/tags/{tag}/posts'>;
export type TagPostsQuery = QueryOf<'/api/tags/{tag}/posts'>;

/** Backend limits (backend/src/blog/blog.constants.ts and common/constants.ts). */
export const POST_SEARCH_MAX_LENGTH = 100;
export const TAG_MAX_LENGTH = 30;

/** Published posts, optionally filtered by `tag` and searched with `q` (public). */
export const postsKey = (query?: PostsQuery) => withQuery('/api/posts', query);

/** Published posts with one tag (public). The backend trims and lower-cases the tag. */
export const tagPostsKey = (tag: string, query?: TagPostsQuery) =>
  withQuery(`/api/tags/${encodeURIComponent(tag)}/posts`, query);

export function listPosts(query?: PostsQuery, signal?: AbortSignal): Promise<PostsPage> {
  return api<PostsPage>(postsKey(query), { signal });
}

export function listPostsByTag(tag: string, query?: TagPostsQuery, signal?: AbortSignal): Promise<TagPostsPage> {
  return api<TagPostsPage>(tagPostsKey(tag, query), { signal });
}

/** Site link to a post page and to a tag page. */
export const postHref = (id: string) => `/blog/${encodeURIComponent(id)}`;
export const tagHref = (tag: string) => `/blog/tag/${encodeURIComponent(tag)}`;
