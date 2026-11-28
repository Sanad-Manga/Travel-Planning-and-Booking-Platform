import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TAG_MAX_LENGTH, tagHref, tagPostsKey } from '@/api/blog';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { PageHeader } from '@/components/PageHeader';
import { BlogResults } from '@/features/blog/BlogResults';
import { loadPosts } from '@/features/blog/loadPosts';
import { pageParam, type ParamValue } from '@/features/blog/searchParams';

type Params = Promise<{ tag: string }>;
type SearchParams = Promise<Record<string, ParamValue>>;

const SITE = 'Travel Planning and Booking Platform';

/** Tags are stored trimmed and lower-case, so the page matches them the same way. Invalid tags give 404. */
function readTag(raw: string): string {
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    // Already decoded and contains a bare "%": use it as it is.
  }
  const tag = text.trim().toLowerCase();
  if (!tag || tag.length > TAG_MAX_LENGTH) notFound();
  return tag;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const tag = readTag((await params).tag);
  const title = `#${tag} | Blog | ${SITE}`;
  const description = `Travel stories tagged #${tag}.`;
  return {
    title,
    description,
    alternates: { canonical: tagHref(tag) },
    openGraph: { title, description, type: 'website' },
  };
}

/** BLG-08: every published post with one tag, reached by clicking a tag. Rendered on each request. */
export default async function TagPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const tag = readTag((await params).tag);
  const page = pageParam((await searchParams).page);
  // The backend answers 400 for a tag it rejects; to a reader that tag page simply doesn't exist.
  const result = await loadPosts(tagPostsKey(tag, { page: page > 1 ? page : undefined }), { notFoundOnBadInput: true });

  return (
    <>
      <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Blog', href: '/blog' }, { label: `#${tag}` }]} />
      <PageHeader title={`Posts tagged #${tag}`} description="Travel stories that use this tag."
        action={<Link className="btn" href="/blog">All posts</Link>} />
      <BlogResults result={result} basePath={tagHref(tag)}
        empty={{ icon: '🏷️', title: `No posts tagged #${tag} yet`, description: 'Try another tag or browse every post.',
          action: { label: 'Show all posts', href: '/blog' } }} />
    </>
  );
}
