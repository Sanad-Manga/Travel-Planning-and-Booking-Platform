import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VerifyEmailBanner } from './VerifyEmailBanner';

let pathname = '/';
let auth: { user: { email: string; emailVerified: boolean; mustChangePassword?: boolean } | null; loading: boolean; refresh: () => Promise<void> };
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => auth }));

const fetchMock = vi.fn();
const unverified = { email: 'ali@example.com', emailVerified: false };

beforeEach(() => {
  pathname = '/';
  fetchMock.mockReset();
  refresh.mockReset();
  refresh.mockResolvedValue(undefined);
  vi.stubGlobal('fetch', fetchMock);
  auth = { user: unverified, loading: false, refresh };
});

describe('VerifyEmailBanner (ACC-02)', () => {
  it('shows only for a signed-in user whose email is not verified', () => {
    const { rerender } = render(<VerifyEmailBanner />);
    expect(screen.getByText(/Verify your email to book flights and hotels/)).toBeInTheDocument();

    auth = { user: { ...unverified, emailVerified: true }, loading: false, refresh };
    rerender(<VerifyEmailBanner />);
    expect(screen.queryByText(/Verify your email/)).not.toBeInTheDocument();

    auth = { user: null, loading: false, refresh };
    rerender(<VerifyEmailBanner />);
    expect(screen.queryByText(/Verify your email/)).not.toBeInTheDocument();
  });

  it('stays out of the way on the verify page itself', () => {
    pathname = '/verify-email';
    render(<VerifyEmailBanner />);
    expect(screen.queryByText(/Verify your email/)).not.toBeInTheDocument();
  });

  it('resend shows a visible confirmation', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: 'Verification email sent' }), { status: 200 }));
    render(<VerifyEmailBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Send a new link' }));
    expect(await screen.findByText('We sent a new link to ali@example.com. It works for 24 hours.')).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/resend-verification');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' });
  });

  it('a resend within the cooldown says how long to wait', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ statusCode: 429, message: 'Too many requests' }), { status: 429, headers: { 'Retry-After': '42' } }),
    );
    render(<VerifyEmailBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Send a new link' }));
    expect(await screen.findByText(/Please try again in 42 seconds/)).toBeInTheDocument();
  });

  it('if the email turns out to be verified already, it refreshes the user instead', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: 'Email already verified' }), { status: 200 }));
    render(<VerifyEmailBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Send a new link' }));
    expect(await screen.findByText('Your email is already verified.')).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });
});
