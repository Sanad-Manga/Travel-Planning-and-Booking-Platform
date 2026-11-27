import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import ErrorPage from './error';
import Loading from './loading';
import NotFound from './not-found';

describe('app-level error, not-found and loading screens (#224)', () => {
  it('error page explains the problem and Try again re-fetches the page', async () => {
    const retry = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorPage error={new Error('boom')} retry={retry} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getByText('Something went wrong.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('error page uses the friendly message of an API error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorPage error={new ApiError(403, 'Forbidden')} retry={vi.fn()} />);
    expect(screen.getByText('You don’t have permission to do that.')).toBeInTheDocument();
  });

  it('not-found page has an h1 and a way home', () => {
    render(<NotFound />);
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
  });

  it('loading page announces that the page is loading', () => {
    render(<Loading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading page');
  });
});
