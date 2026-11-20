'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { loginUrl } from '@/lib/returnTo';
import { rememberPendingAction } from '@/lib/pendingAction';
import { Spinner } from './Spinner';
import { useAuth } from './AuthProvider';

export interface RequireAuthProps {
  children: ReactNode;
  /** Optional short identifier of what the guest was doing ("book-room"), resumed after login. */
  action?: string;
}

/**
 * ACC-10: wrap a page (or a part of one) that needs a logged-in user. A guest is sent to
 * `/login?returnTo=<current path and query>` and brought back after logging in. This is a convenience
 * for the person: the backend enforces access on every request regardless.
 */
export function RequireAuth({ children, action }: RequireAuthProps) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const guest = !loading && !user;
  useEffect(() => {
    if (!guest) return;
    // Read the query from the address bar: useSearchParams would force every page using this into a Suspense boundary.
    const returnTo = `${pathname}${window.location.search}`;
    rememberPendingAction({ path: returnTo, action });
    router.replace(loginUrl(returnTo));
  }, [guest, pathname, action, router]);

  if (user) return <>{children}</>;
  return <Spinner label={guest ? 'Taking you to sign in' : 'Checking your session'} />;
}
