import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { rememberPendingAction, readPendingAction } from '@/lib/pendingAction';
import { AuthProvider, type AuthUser } from './AuthProvider';
import { LoginForm } from './LoginForm';

vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api')>()), api: vi.fn() }));

const replace = vi.fn();
let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(search),
}));

const apiMock = vi.mocked(api);

const ziad: AuthUser = {
  id: 'u1',
  name: 'Ziad',
  email: 'ziad@example.com',
  role: 'USER',
  status: 'ACTIVE',
  emailVerified: true,
  preferredCurrency: 'USD',
};

/** /auth/me answers 401 (a guest); /auth/login is whatever the test says. */
function backend(login: () => Promise<unknown>) {
  apiMock.mockImplementation((path: string) => {
    if (path === '/auth/me') return Promise.reject(new ApiError(401, 'Unauthorized'));
    if (path === '/auth/login') return login() as Promise<never>;
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

async function setup() {
  const user = userEvent.setup();
  render(
    <AuthProvider>
      <LoginForm />
    </AuthProvider>,
  );
  await screen.findByRole('button', { name: 'Log in' });
  return user;
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, email = 'ziad@example.com', password = 'Passw0rdOK') {
  if (email) await user.type(screen.getByLabelText(/Email/), email);
  if (password) await user.type(screen.getByLabelText(/Password/), password);
  await user.click(screen.getByRole('button', { name: 'Log in' }));
}

beforeEach(() => {
  apiMock.mockReset();
  replace.mockReset();
  search = '';
  sessionStorage.clear();
});

describe('LoginForm (ACC-10)', () => {
  it('has labelled email and password fields, a heading and the help links', async () => {
    backend(() => Promise.resolve(ziad));
    await setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Login' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Email/)).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText(/Email/)).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText(/Password/)).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText(/Password/)).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/register');
    expect(screen.getByRole('link', { name: 'Forgot your password?' })).toHaveAttribute('href', '/forgot-password');
  });

  it('on success logs in and goes to the safe returnTo', async () => {
    search = 'returnTo=%2Ftrips%3Fid%3D5';
    backend(() => Promise.resolve(ziad));
    const user = await setup();
    await fillAndSubmit(user, '  ziad@example.com ');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/trips?id=5'));
    expect(apiMock).toHaveBeenCalledWith('/auth/login', {
      method: 'POST',
      body: { email: 'ziad@example.com', password: 'Passw0rdOK' },
      retryOn401: false,
      redirectOn401: false,
    });
  });

  it('goes home when there is no returnTo', async () => {
    backend(() => Promise.resolve(ziad));
    const user = await setup();
    await fillAndSubmit(user);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
  });

  it.each([
    ['ADMIN', '/admin'],
    ['AIRLINE_MODERATOR', '/airline'],
    ['HOTEL_MODERATOR', '/hotel'],
    ['USER', '/'],
  ] as const)('a %s with no returnTo goes to their role home %s (ACC-04)', async (role, home) => {
    backend(() => Promise.resolve({ ...ziad, role }));
    const user = await setup();
    await fillAndSubmit(user);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(home));
  });

  it('a moderator with a returnTo still goes to the returnTo', async () => {
    search = 'returnTo=%2Fblog';
    backend(() => Promise.resolve({ ...ziad, role: 'ADMIN' }));
    const user = await setup();
    await fillAndSubmit(user);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/blog'));
  });

  it('a user with a temporary password goes to /change-password, even with a returnTo (ACC-11)', async () => {
    search = 'returnTo=%2Fblog';
    backend(() => Promise.resolve({ ...ziad, role: 'ADMIN', mustChangePassword: true }));
    const user = await setup();
    await fillAndSubmit(user);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/change-password'));
    expect(replace).not.toHaveBeenCalledWith('/blog');
  });

  it.each(['//evil.com', 'https://evil.com', '/\\evil.com', '/%5Cevil.com', 'javascript:alert(1)'])(
    'ignores the hostile returnTo %s',
    async (hostile) => {
      search = `returnTo=${encodeURIComponent(hostile)}`;
      backend(() => Promise.resolve(ziad));
      const user = await setup();
      await fillAndSubmit(user);
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
      expect(replace).not.toHaveBeenCalledWith(hostile);
    },
  );

  it('leaves the remembered action in place for the page it returns to', async () => {
    search = 'returnTo=%2Fhotels%2F1';
    rememberPendingAction({ path: '/hotels/1', action: 'book-room' });
    backend(() => Promise.resolve(ziad));
    const user = await setup();
    await fillAndSubmit(user);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/hotels/1'));
    expect(readPendingAction()).toEqual({ path: '/hotels/1', action: 'book-room' });
  });

  it('shows field-level errors from details[] under the right fields and no alert', async () => {
    backend(() =>
      Promise.reject(
        new ApiError(
          400,
          'Validation failed',
          [
            { field: 'email', message: 'email must be valid' },
            { field: 'password', message: 'password should not be empty' },
          ],
          null,
          {
            statusCode: 400,
            message: 'Validation failed',
            details: [
              { field: 'email', message: 'email must be valid' },
              { field: 'password', message: 'password should not be empty' },
            ],
          },
        ),
      ),
    );
    const user = await setup();
    await fillAndSubmit(user, 'ziad@example.com');
    const email = await screen.findByLabelText(/Email/);
    await waitFor(() => expect(email).toBeInvalid());
    expect(email).toHaveAccessibleDescription('email must be valid');
    expect(screen.getByLabelText(/Password/)).toHaveAccessibleDescription('password should not be empty');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('401 says the email or password is wrong, in an alert, keeps the email and clears the password', async () => {
    backend(() => Promise.reject(new ApiError(401, 'Invalid email or password')));
    const user = await setup();
    await fillAndSubmit(user);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Email or password is incorrect.');
    expect(alert).toHaveTextContent(/reset|try again/i);
    expect(screen.getByLabelText(/Email/)).toHaveValue('ziad@example.com');
    expect(screen.getByLabelText(/Password/)).toHaveValue('');
    expect(replace).not.toHaveBeenCalled();
  });

  it('423 says the account is locked', async () => {
    backend(() => Promise.reject(new ApiError(423, 'Account locked')));
    const user = await setup();
    await fillAndSubmit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(/locked/i);
  });

  it('403 says the account is suspended', async () => {
    backend(() => Promise.reject(new ApiError(403, 'Account suspended')));
    const user = await setup();
    await fillAndSubmit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(/suspended/i);
  });

  it('a network failure shows an alert with Try again that submits again', async () => {
    let calls = 0;
    backend(() => (++calls === 1 ? Promise.reject(new TypeError('offline')) : Promise.resolve(ziad)));
    const user = await setup();
    await fillAndSubmit(user);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn.t reach the server/i);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(calls).toBe(2);
  });

  it('does not call the API when a field is empty, and says what to fix', async () => {
    backend(() => Promise.resolve(ziad));
    const user = await setup();
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(screen.getByLabelText(/Email/)).toHaveAccessibleDescription('Enter your email address.');
    expect(screen.getByLabelText(/Password/)).toHaveAccessibleDescription('Enter your password.');
    expect(apiMock).not.toHaveBeenCalledWith('/auth/login', expect.anything());
  });

  it('rejects an obviously malformed email before calling the API', async () => {
    backend(() => Promise.resolve(ziad));
    const user = await setup();
    await fillAndSubmit(user, 'not-an-email');
    expect(screen.getByLabelText(/Email/)).toHaveAccessibleDescription(/valid email/i);
    expect(apiMock).not.toHaveBeenCalledWith('/auth/login', expect.anything());
  });

  it('disables the button and shows a spinner while logging in', async () => {
    let finish: (u: AuthUser) => void = () => undefined;
    backend(() => new Promise<AuthUser>((resolve) => (finish = resolve)));
    const user = await setup();
    await fillAndSubmit(user);
    const button = await screen.findByRole('button', { name: 'Logging in…' });
    expect(button).toBeDisabled();
    finish(ziad);
    await waitFor(() => expect(replace).toHaveBeenCalled());
  });

  it('a user who is already logged in is sent straight on', async () => {
    search = 'returnTo=%2Ftrips';
    apiMock.mockResolvedValue(ziad);
    render(
      <AuthProvider>
        <LoginForm />
      </AuthProvider>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/trips'));
  });
});
