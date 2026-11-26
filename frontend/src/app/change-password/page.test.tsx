import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChangePasswordPage from './page';

const replace = vi.fn();
let auth: { user: { id: string; mustChangePassword?: boolean } | null; loading: boolean } = { user: null, loading: false };
vi.mock('next/navigation', () => ({ usePathname: () => '/change-password', useRouter: () => ({ replace }) }));
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => ({ ...auth, logout: vi.fn(), resetSession: vi.fn() }) }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

beforeEach(() => {
  replace.mockReset();
  auth = { user: null, loading: false };
});

describe('/change-password page (ACC-11)', () => {
  it('sends a guest to plain /login', async () => {
    render(<ChangePasswordPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('shows the form to a user who must change their password, without redirecting in a loop', () => {
    auth = { user: { id: 'u', mustChangePassword: true }, loading: false };
    render(<ChangePasswordPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Change password' })).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('also serves an ordinary logged-in user', () => {
    auth = { user: { id: 'u' }, loading: false };
    render(<ChangePasswordPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Change password' })).toBeInTheDocument();
  });
});
