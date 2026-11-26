'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { loginUrl } from '@/lib/returnTo';
import { FORCED_PASSWORD_PATH } from '@/lib/roles';
import { rememberPendingAction } from '@/lib/pendingAction';
import { Spinner } from './Spinner';
import { useAuth } from './AuthProvider';

export interface RequireAuthProps {
  children: ReactNode;
  /** Optional short identifier of what the guest was doing ("book-room"), resumed after login. */
  action?: string;
  /** The user may see this page even while they must change a temporary password (only /change-password). */
  allowMustChange?: boolean;
  /** Default true. False sends a guest to plain /login: for a page that makes no sense to come back to. */
  resumeAfterLogin?: boolean;
}

/**
 * ACC-10: wrap a page (or a part of one) that needs a logged-in user. A guest is sent to
 * `/login?returnTo=<current path and query>` and brought back after logging in. This is a convenience
 * for the person: the backend enforces access on every request regardless.
 */
export function RequireAuth({ children, action, allowMustChange = false, resumeAfterLogin = true }: RequireAuthProps) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const guest = !loading && !user;
  // ACC-11: with a temporary password the only usable page is /change-password.
  const forced = !allowMustChange && !!user?.mustChangePassword;
  useEffect(() => {
    if (forced) router.replace(FORCED_PASSWORD_PATH);
  }, [forced, router]);
  useEffect(() => {
    if (!guest) return;
    if (!resumeAfterLogin) {
      router.replace('/login');
      return;
    }
    // Read the query from the address bar: useSearchParams would force every page using this into a Suspense boundary.
    const returnTo = `${pathname}${window.location.search}`;
    rememberPendingAction({ path: returnTo, action });
    router.replace(loginUrl(returnTo));
  }, [guest, pathname, action, resumeAfterLogin, router]);

  if (user && !forced) return <>{children}</>;
  const label = forced ? 'Taking you to change your password' : guest ? 'Taking you to sign in' : 'Checking your session';
  return <Spinner label={label} />;
}
