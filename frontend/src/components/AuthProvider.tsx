'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { clearPendingAction } from '@/lib/pendingAction';

/** The backend's UserResponseDto. No token or password hash is ever part of it. */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'USER' | 'ADMIN' | 'AIRLINE_MODERATOR' | 'HOTEL_MODERATOR';
  status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  emailVerified: boolean;
  preferredCurrency: string;
  mustChangePassword?: boolean;
  airlineId?: string;
  hotelId?: string;
  phone?: string;
}

interface Auth {
  /** The logged-in user, or null for a guest (also null while `loading`). */
  user: AuthUser | null;
  /** True until the first GET /api/auth/me has answered. */
  loading: boolean;
  /** Rejects with an ApiError (wrong password, locked account, validation) for the caller to show. */
  login: (email: string, password: string) => Promise<AuthUser>;
  /** Rejects if the server could not be reached; the user then stays signed in. */
  logout: () => Promise<void>;
}

const AuthContext = createContext<Auth | null>(null);

/**
 * Mount once near the root (see app/layout). The session itself lives only in the httpOnly cookies, so
 * this holds just the user object from `GET /api/auth/me`: nothing secret, nothing in web storage.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    // A guest (401, after one refresh attempt) or an unreachable server both simply mean "not logged in".
    api<AuthUser>('/auth/me', { redirectOn401: false })
      .then((me) => {
        if (active) setUser(me);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const me = await api<AuthUser>('/auth/login', {
      method: 'POST',
      body: { email, password },
      retryOn401: false, // here a 401 means "wrong email or password", not "session expired"
      redirectOn401: false,
    });
    setUser(me);
    return me;
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST', retryOn401: false, redirectOn401: false });
    setUser(null);
    clearPendingAction();
  }, []);

  const value = useMemo<Auth>(() => ({ user, loading, login, logout }), [user, loading, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside <AuthProvider>');
  return auth;
}
