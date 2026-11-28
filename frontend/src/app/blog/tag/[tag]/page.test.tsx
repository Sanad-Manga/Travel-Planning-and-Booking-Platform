import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';

const serverApi = vi.fn();
const push = vi.fn();
vi.mock('@/lib/serverApi', () => ({ serverApi: (...args: unknown[]) => serverApi(...args) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));

const { default: TagPage, generateMetadata } = await import('./page');

const post = {
  id: 'p1', title: 'Street food in Cairo', author: { id: 'u1', name: 'Mona Adel' }, tags: ['food'],
  publishedAt: '2026-11-20T14:30:00.000Z', excerpt: '', likeCount: 0, commentCount: 0,
};
const ok = (items: unknown[], extra: object = {}) =>
  ({ ok: true, data: { items, page: 1, limit: 10, total: items.length, totalPages: items.length ? 1 : 0, ...extra } });

const renderTag = async (tag: string, search: Record<string, string> = {}) =>
  render(await TagPage({ params: Promise.resolve({ tag }), searchParams: Promise.resolve(search) }));

describe('/blog/tag/[tag] (BLG-08)', () => {
  beforeEach(() => {
    serverApi.mockReset();
    push.mockReset();
  });

  it('lists the posts with that tag, matched lower-case', async () => {
    serverApi.mockResolvedValue(ok([post], { total: 11, totalPages: 2 }));
    await renderTag('Food');
    expect(serverApi).toHaveBeenCalledWith('/api/tags/food/posts');
    expect(screen.getByRole('heading', { level: 1, name: 'Posts tagged #food' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Street food in Cairo' })).toHaveAttribute('href', '/blog/p1');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('HomeBlog#food');
    screen.getByRole('button', { name: 'Next page' }).click();
    expect(push).toHaveBeenCalledWith('/blog/tag/food?page=2');
  });

  it('encodes a tag with spaces or symbols in the request', async () => {
    serverApi.mockResolvedValue(ok([]));
    await renderTag('road%20trip', { page: '3' });
    expect(serverApi).toHaveBeenCalledWith('/api/tags/road%20trip/posts?page=3');
  });

  it('shows an empty state for a tag nobody used yet', async () => {
    serverApi.mockResolvedValue(ok([]));
    await renderTag('antarctica');
    expect(screen.getByRole('heading', { name: 'No posts tagged #antarctica yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show all posts' })).toHaveAttribute('href', '/blog');
  });

  it('is not found for a tag longer than 30 characters, without asking the backend', async () => {
    await expect(renderTag('x'.repeat(31))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(serverApi).not.toHaveBeenCalled();
  });

  it('is not found when the backend rejects the tag', async () => {
    serverApi.mockRejectedValue(new ApiError(400, 'Validation failed'));
    await expect(renderTag('bad')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('has a title and description naming the tag', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ tag: 'Cairo' }) });
    expect(meta.title).toBe('#cairo | Blog | Travel Planning and Booking Platform');
    expect(meta.description).toBe('Travel stories tagged #cairo.');
  });
});
