import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { rememberPendingAction, readPendingAction } from '@/lib/pendingAction';
import { AuthProvider, useAuth, type AuthUser } from './AuthProvider';

vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api')>()), api: vi.fn() }));

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

const captured: { auth?: ReturnType<typeof useAuth> } = {};
function Probe() {
  const current = useAuth();
  useEffect(() => {
    captured.auth = current;
  });
  return <p>{current.loading ? 'loading' : current.user ? `hello ${current.user.name}` : 'guest'}</p>;
}
const auth = new Proxy({} as ReturnType<typeof useAuth>, {
  get: (_target, key) => Reflect.get(captured.auth as object, key),
  ownKeys: () => Reflect.ownKeys(captured.auth as object),
  getOwnPropertyDescriptor: (_target, key) => ({ enumerable: true, configurable: true, value: Reflect.get(captured.auth as object, key) }),
});

function mount() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
  sessionStorage.clear();
});

describe('AuthProvider / useAuth (ACC-10)', () => {
  it('starts loading, then has the user from GET /auth/me', async () => {
    apiMock.mockResolvedValueOnce(ziad);
    mount();
    expect(screen.getByText('loading')).toBeInTheDocument();
    expect(await screen.findByText('hello Ziad')).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith('/auth/me', { redirectOn401: false });
  });

  it('treats a 401 from /auth/me as a guest, not an error', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(401, 'Unauthorized'));
    mount();
    expect(await screen.findByText('guest')).toBeInTheDocument();
  });

  it('treats a network failure as a guest and stops loading', async () => {
    apiMock.mockRejectedValueOnce(new TypeError('offline'));
    mount();
    expect(await screen.findByText('guest')).toBeInTheDocument();
  });

  it('login posts the credentials without refresh or redirect, and sets the user', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(401, 'Unauthorized'));
    mount();
    await screen.findByText('guest');

    apiMock.mockResolvedValueOnce(ziad);
    let returned: AuthUser | undefined;
    await act(async () => {
      returned = await auth.login('ziad@example.com', 'Passw0rdOK');
    });
    expect(apiMock).toHaveBeenLastCalledWith('/auth/login', {
      method: 'POST',
      body: { email: 'ziad@example.com', password: 'Passw0rdOK' },
      retryOn401: false,
      redirectOn401: false,
    });
    expect(returned).toEqual(ziad);
    expect(screen.getByText('hello Ziad')).toBeInTheDocument();
  });

  it('a failed login rejects and leaves the user a guest', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(401, 'Unauthorized'));
    mount();
    await screen.findByText('guest');

    apiMock.mockRejectedValueOnce(new ApiError(401, 'Invalid email or password'));
    await expect(auth.login('a@b.com', 'wrong')).rejects.toMatchObject({ statusCode: 401 });
    expect(screen.getByText('guest')).toBeInTheDocument();
  });

  it('never keeps the password or any token in the context value', async () => {
    apiMock.mockResolvedValueOnce(ziad);
    mount();
    await screen.findByText('hello Ziad');
    expect(Object.keys(auth).sort()).toEqual(['loading', 'login', 'logout', 'refresh', 'resetSession', 'user']);
    expect(JSON.stringify(auth.user)).not.toMatch(/password|token/i);
  });

  it('logout calls the API, clears the user and the remembered action', async () => {
    apiMock.mockResolvedValueOnce(ziad);
    mount();
    await screen.findByText('hello Ziad');
    rememberPendingAction({ path: '/hotels/1', action: 'book-room' });

    apiMock.mockResolvedValueOnce({ message: 'Logged out' });
    await act(async () => {
      await auth.logout();
    });
    expect(apiMock).toHaveBeenLastCalledWith('/auth/logout', { method: 'POST', retryOn401: false, redirectOn401: false });
    expect(screen.getByText('guest')).toBeInTheDocument();
    expect(readPendingAction()).toBeNull();
  });

  it('if logout fails the user stays signed in (so the screen does not lie) and the error is thrown', async () => {
    apiMock.mockResolvedValueOnce(ziad);
    mount();
    await screen.findByText('hello Ziad');

    apiMock.mockRejectedValueOnce(new TypeError('offline'));
    await expect(auth.logout()).rejects.toBeInstanceOf(TypeError);
    await waitFor(() => expect(screen.getByText('hello Ziad')).toBeInTheDocument());
  });

  it('resetSession forgets the user locally without calling the API (the server already ended the session)', async () => {
    apiMock.mockResolvedValueOnce(ziad);
    mount();
    await screen.findByText('hello Ziad');
    rememberPendingAction({ path: '/hotels/1', action: 'book-room' });
    apiMock.mockClear();
    act(() => auth.resetSession());
    expect(screen.getByText('guest')).toBeInTheDocument();
    expect(readPendingAction()).toBeNull();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('useAuth outside the provider is a clear error', () => {
    function Lonely() {
      useAuth();
      return null;
    }
    expect(() => render(<Lonely />)).toThrow('useAuth must be used inside <AuthProvider>');
  });

  it('refresh reloads the user from GET /auth/me (for example after the email is verified)', async () => {
    apiMock.mockResolvedValueOnce({ ...ziad, emailVerified: false });
    mount();
    await screen.findByText('hello Ziad');
    expect(captured.auth?.user?.emailVerified).toBe(false);

    apiMock.mockResolvedValueOnce(ziad);
    await act(async () => {
      await auth.refresh();
    });
    expect(apiMock).toHaveBeenLastCalledWith('/auth/me', { redirectOn401: false });
    expect(captured.auth?.user?.emailVerified).toBe(true);
  });
});
