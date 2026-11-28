import type { Metadata } from 'next';
import Link from 'next/link';
import { postsKey } from '@/api/blog';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { PageHeader } from '@/components/PageHeader';
import { emptyMessages } from '@/components/emptyMessages';
import { BlogResults } from '@/features/blog/BlogResults';
import { BlogSearchForm } from '@/features/blog/BlogSearchForm';
import { loadPosts } from '@/features/blog/loadPosts';
import { firstParam, pageParam, type ParamValue } from '@/features/blog/searchParams';
import styles from '@/features/blog/blog.module.css';

type SearchParams = Promise<Record<string, ParamValue>>;

const SITE = 'Travel Planning and Booking Platform';
const DESCRIPTION = 'Read travel stories from other travellers. Search by title, tag or author.';

/** BLG-02/09: the title says what is being searched, so tabs and shared links stay clear. */
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const params = await searchParams;
  const q = firstParam(params.q);
  const tag = firstParam(params.tag);
  const what = q ? `Search: ${q}` : tag ? `#${tag.toLowerCase()}` : 'Blog';
  const title = `${what} | ${q || tag ? 'Blog | ' : ''}${SITE}`;
  return {
    title,
    description: DESCRIPTION,
    alternates: { canonical: '/blog' },
    openGraph: { title, description: DESCRIPTION, type: 'website' },
    // Search result pages are not worth indexing; the plain list is.
    robots: q || tag ? { index: false, follow: true } : undefined,
  };
}

/** BLG-02, BLG-08, BLG-09: published posts, newest first, with search, a tag filter and pagination. Rendered on each request. */
export default async function BlogPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const q = firstParam(params.q);
  const tag = firstParam(params.tag).toLowerCase();
  const page = pageParam(params.page);
  const result = await loadPosts(postsKey({ q, tag, page: page > 1 ? page : undefined }));
  const filtered = Boolean(q || tag);

  return (
    <>
      <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Blog' }]} />
      <PageHeader title="Blog" description="Read and share travel stories."
        action={<Link className="btn btn-primary" href="/blog/new">Write a post</Link>} />
      <BlogSearchForm q={q} tag={tag} />
      {filtered ? (
        <p className={styles.filters} aria-live="polite">
          Showing posts{q ? <> matching “{q}”</> : null}{tag ? <> tagged #{tag}</> : null}.
          <Link href="/blog">Clear search</Link>
        </p>
      ) : null}
      <BlogResults result={result} basePath="/blog" query={{ q, tag }}
        empty={filtered
          ? { ...emptyMessages.postSearch, action: { label: 'Show all posts', href: '/blog' } }
          : { ...emptyMessages.posts, action: { label: 'Write a post', href: '/blog/new' } }} />
    </>
  );
}
