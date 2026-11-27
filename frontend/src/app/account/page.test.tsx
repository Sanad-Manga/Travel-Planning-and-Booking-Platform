import { render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { swrDefaults } from '@/api/useApi';
import AccountPage from './page';

const replace = vi.fn();
let auth: { user: Record<string, unknown> | null; loading: boolean } = { user: null, loading: false };
vi.mock('next/navigation', () => ({ usePathname: () => '/account', useRouter: () => ({ replace }), useSearchParams: () => new URLSearchParams() }));
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => ({ ...auth, logout: vi.fn(), resetSession: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

beforeEach(() => {
  replace.mockReset();
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ items: [], page: 1, limit: 50, total: 0, totalPages: 0 })))));
});

describe('/account page (ACC-08, ACC-09)', () => {
  it('shows the profile form and the password form to a signed-in user', () => {
    auth = { user: { id: 'u1', name: 'Ali', email: 'ali@example.com', role: 'USER', preferredCurrency: 'EGP' }, loading: false };
    render(
      <SWRConfig value={{ ...swrDefaults, provider: () => new Map() }}>
        <AccountPage />
      </SWRConfig>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Your account' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Profile' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Password' })).toBeInTheDocument();
    expect(screen.getByText('ali@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change password' })).toBeInTheDocument();
  });

  it('a guest is sent to log in', async () => {
    auth = { user: null, loading: false };
    render(<AccountPage />);
    await vi.waitFor(() => expect(replace).toHaveBeenCalled());
    expect(replace.mock.calls[0][0]).toMatch(/^\/login/);
  });
});
