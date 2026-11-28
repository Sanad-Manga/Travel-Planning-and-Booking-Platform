import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';

const serverApi = vi.fn();
const push = vi.fn();
vi.mock('@/lib/serverApi', () => ({ serverApi: (...args: unknown[]) => serverApi(...args) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));

const { default: BlogPage, generateMetadata } = await import('./page');

const post = {
  id: 'p1', title: 'Three days in Cairo', author: { id: 'u1', name: 'Mona Adel' }, tags: ['cairo', 'food'],
  publishedAt: '2026-11-20T14:30:00.000Z', excerpt: 'Koshary, the pyramids and more.', likeCount: 1, commentCount: 2,
};
const page = (items: unknown[], extra: object = {}) =>
  ({ ok: true, data: { items, page: 1, limit: 10, total: items.length, totalPages: items.length ? 1 : 0, ...extra } });

async function renderPage(params: Record<string, string> = {}) {
  render(await BlogPage({ searchParams: Promise.resolve(params) }));
}

describe('/blog (BLG-02, BLG-08, BLG-09)', () => {
  beforeEach(() => {
    serverApi.mockReset();
    push.mockReset();
  });

  it('lists published posts with author, date, excerpt, clickable tags and counts', async () => {
    serverApi.mockResolvedValue(page([post]));
    await renderPage();
    expect(serverApi).toHaveBeenCalledWith('/api/posts');
    expect(screen.getByRole('heading', { level: 1, name: 'Blog' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Three days in Cairo' })).toHaveAttribute('href', '/blog/p1');
    expect(screen.getByText(/By Mona Adel/)).toHaveTextContent('20 Nov 2026');
    expect(screen.getByText('Koshary, the pyramids and more.')).toBeInTheDocument();
    const tags = within(screen.getByRole('list', { name: 'Tags' }));
    expect(tags.getByRole('link', { name: '#cairo' })).toHaveAttribute('href', '/blog/tag/cairo');
    expect(screen.getByText('1 like · 2 comments')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Write a post' })).toHaveAttribute('href', '/blog/new');
  });

  it('sends the search, tag and page from the URL and keeps them in the form', async () => {
    serverApi.mockResolvedValue(page([post], { page: 2, total: 11, totalPages: 2 }));
    await renderPage({ q: ' koshary ', tag: 'Cairo', page: '2' });
    expect(serverApi).toHaveBeenCalledWith('/api/posts?q=koshary&tag=cairo&page=2');
    expect(screen.getByRole('searchbox', { name: 'Search posts' })).toHaveValue('koshary');
    expect(screen.getByRole('textbox', { name: 'Tag' })).toHaveValue('cairo');
    expect(screen.getByText(/Showing posts/)).toHaveTextContent('Showing posts matching “koshary” tagged #cairo.');
    expect(screen.getByRole('link', { name: 'Clear search' })).toHaveAttribute('href', '/blog');
  });

  it('ignores a page number that is not a whole number from 1 up', async () => {
    serverApi.mockResolvedValue(page([]));
    await renderPage({ page: '-3' });
    expect(serverApi).toHaveBeenCalledWith('/api/posts');
  });

  it('moves between pages through the URL and keeps the filters', async () => {
    serverApi.mockResolvedValue(page([post], { total: 11, totalPages: 2 }));
    await renderPage({ q: 'nile' });
    screen.getByRole('button', { name: 'Next page' }).click();
    expect(push).toHaveBeenCalledWith('/blog?q=nile&page=2');
  });

  it('shows an empty state when there are no posts at all', async () => {
    serverApi.mockResolvedValue(page([]));
    await renderPage();
    expect(screen.getByRole('heading', { name: 'No posts yet' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Write a post' }).at(-1)).toHaveAttribute('href', '/blog/new');
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
  });

  it('shows a search empty state with a way back to every post', async () => {
    serverApi.mockResolvedValue(page([]));
    await renderPage({ q: 'zzz' });
    expect(screen.getByRole('heading', { name: 'No posts match your search' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show all posts' })).toHaveAttribute('href', '/blog');
  });

  it('says when a page number is past the end of the list', async () => {
    serverApi.mockResolvedValue(page([], { page: 9, total: 3, totalPages: 1 }));
    await renderPage({ tag: 'food', page: '9' });
    expect(screen.getByRole('heading', { name: 'There are no posts on this page' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the first page' })).toHaveAttribute('href', '/blog?tag=food');
  });

  it('shows a friendly error instead of crashing when the backend fails', async () => {
    serverApi.mockRejectedValue(new ApiError(500, 'Internal server error'));
    await renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent("We couldn't load the posts");
  });

  it('has metadata, and keeps search pages out of search engines', async () => {
    const plain = await generateMetadata({ searchParams: Promise.resolve({}) });
    expect(plain.title).toBe('Blog | Travel Planning and Booking Platform');
    expect(plain.description).toBeTruthy();
    expect(plain.robots).toBeUndefined();
    const search = await generateMetadata({ searchParams: Promise.resolve({ q: 'nile' }) });
    expect(search.title).toBe('Search: nile | Blog | Travel Planning and Booking Platform');
    expect(search.robots).toEqual({ index: false, follow: true });
  });
});
