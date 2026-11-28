import type { PostListRow } from '@/api/blog';
import type { Page } from '@/api/types';
import { Alert } from '@/components/Alert';
import { EmptyState, type EmptyStateProps } from '@/components/EmptyState';
import type { FriendlyError } from '@/lib/apiError';
import { PagerLinks } from './PagerLinks';
import { PostList } from './PostList';

/** What a server-rendered list page loaded: a page of posts, or a friendly error to show instead. */
export type ListResult = { ok: true; page: Page<PostListRow> } | { ok: false; error: FriendlyError };

export interface BlogResultsProps {
  result: ListResult;
  /** Where the pager links go, and the filters it keeps. */
  basePath: string;
  query?: Record<string, string>;
  /** What to show when the list has no posts at all. */
  empty: EmptyStateProps;
}

/** The list part of /blog and /blog/tag/[tag]: posts + pager, an empty state, or an error. */
export function BlogResults({ result, basePath, query, empty }: BlogResultsProps) {
  if (!result.ok) {
    return <Alert variant="error" title="We couldn't load the posts" hint={result.error.hint}>{result.error.message}</Alert>;
  }
  const { items, page, totalPages, total, limit } = result.page;
  if (items.length === 0) {
    // A page past the end (e.g. an old link to ?page=9) is not the same as "no posts".
    const pastTheEnd = total > 0;
    return pastTheEnd
      ? <EmptyState title="There are no posts on this page" description={`This list has ${totalPages} page${totalPages === 1 ? '' : 's'}.`}
          action={{ label: 'Go to the first page', href: `${basePath}${firstPageQuery(query)}` }} />
      : <EmptyState {...empty} />;
  }
  return (
    <>
      <PostList posts={items} />
      <PagerLinks basePath={basePath} query={query} page={page} totalPages={totalPages} total={total} limit={limit} />
    </>
  );
}

function firstPageQuery(query: Record<string, string> = {}): string {
  const text = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== '')).toString();
  return text ? `?${text}` : '';
}
