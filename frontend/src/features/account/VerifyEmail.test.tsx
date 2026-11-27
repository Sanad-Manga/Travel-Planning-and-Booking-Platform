import { render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VerifyEmail } from './VerifyEmail';

const refresh = vi.fn();
let auth: { user: { email: string; emailVerified: boolean } | null; loading: boolean; refresh: () => Promise<void> };
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => auth }));

const fetchMock = vi.fn();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const invalid = () =>
  json(400, { statusCode: 400, message: 'Validation failed', details: [{ field: 'token', message: 'invalid or expired verification link' }] });

beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
  refresh.mockResolvedValue(undefined);
  vi.stubGlobal('fetch', fetchMock);
  auth = { user: null, loading: false, refresh };
});

describe('VerifyEmail page (ACC-02)', () => {
  it('a valid link: sends the token once (even in StrictMode), shows success and refreshes the signed-in user', async () => {
    auth.user = { email: 'ali@example.com', emailVerified: false };
    fetchMock.mockResolvedValue(json(200, { message: 'Email verified' }));
    render(
      <StrictMode>
        <VerifyEmail token="abc_123" />
      </StrictMode>,
    );
    expect(await screen.findByText('Your email is verified.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/verify-email?token=abc_123');
    expect(refresh).toHaveBeenCalled();
  });

  it('an already verified account gets a clear success too', async () => {
    fetchMock.mockResolvedValue(json(200, { message: 'Email already verified' }));
    render(<VerifyEmail token="abc" />);
    expect(await screen.findByText('Your email was already verified.')).toBeInTheDocument();
  });

  it('an invalid or expired link explains it and offers a new link to a signed-in user', async () => {
    auth.user = { email: 'ali@example.com', emailVerified: false };
    fetchMock.mockResolvedValueOnce(invalid());
    render(<VerifyEmail token="old" />);
    expect(await screen.findByText('This link is invalid or has expired.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send a new link' })).toBeInTheDocument();
  });

  it('an invalid link sends a guest to log in for a new link', async () => {
    fetchMock.mockResolvedValueOnce(invalid());
    render(<VerifyEmail token="old" />);
    expect(await screen.findByText('This link is invalid or has expired.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Log in/ })).toHaveAttribute('href', '/login');
  });

  it('while the session is still loading it offers neither "Log in" nor a resend button', async () => {
    auth.loading = true;
    fetchMock.mockResolvedValueOnce(invalid());
    render(<VerifyEmail token="old" />);
    expect(await screen.findByText('This link is invalid or has expired.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Log in/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send a new link' })).not.toBeInTheDocument();
  });

  it('a link without a token makes no request', () => {
    render(<VerifyEmail token="" />);
    expect(screen.getByText('This link is incomplete.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
