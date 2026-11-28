'use client';

import { useRouter } from 'next/navigation';
import { withQuery } from '@/api/types';
import { Pagination } from '@/components/Pagination';

export interface PagerLinksProps {
  /** The list page this pager belongs to, without a query: "/blog" or "/blog/tag/cairo". */
  basePath: string;
  /** Filters to keep when the page changes (`q`, `tag`). Empty values are dropped. */
  query?: Record<string, string>;
  page: number;
  totalPages: number;
  total: number;
  limit: number;
}

/**
 * The shared `Pagination` for a server-rendered list: the page number lives in the URL, so changing page
 * navigates and the server renders the new page. Page 1 is left out of the URL to keep one address per page.
 */
export function PagerLinks({ basePath, query = {}, ...page }: PagerLinksProps) {
  const router = useRouter();
  return (
    <Pagination {...page}
      onPageChange={(next) => router.push(withQuery(basePath, { ...query, page: next > 1 ? next : undefined }))} />
  );
}
