import { notFound } from 'next/navigation';
import type { PostListRow } from '@/api/blog';
import type { Page } from '@/api/types';
import { ApiError } from '@/lib/api';
import { toFriendlyError } from '@/lib/apiError';
import { serverApi } from '@/lib/serverApi';
import type { ListResult } from './BlogResults';

/**
 * Loads a public post list while the server renders the page (dynamic SSR, never cached).
 * The list is public, so the backend does not answer 401 here; any failure becomes a friendly message.
 * With `notFoundOnBadInput`, a 400 (e.g. a tag the backend rejects) shows the 404 page instead.
 */
export async function loadPosts(path: string, { notFoundOnBadInput = false } = {}): Promise<ListResult> {
  try {
    const result = await serverApi<Page<PostListRow>>(path);
    if (!result.ok) return { ok: false, error: toFriendlyError({ status: 401 }) };
    return { ok: true, page: result.data };
  } catch (error) {
    if (notFoundOnBadInput && error instanceof ApiError && error.status === 400) notFound();
    return { ok: false, error: toFriendlyError(error) };
  }
}
