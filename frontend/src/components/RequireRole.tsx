'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { homePathFor, type Role } from '@/lib/roles';
import { Alert } from './Alert';
import { useAuth } from './AuthProvider';
import { RequireAuth } from './RequireAuth';

export interface RequireRoleProps {
  /** The roles allowed to see the page. */
  roles: readonly Role[];
  children: ReactNode;
}

function RoleGate({ roles, children }: RequireRoleProps) {
  const { user } = useAuth();
  if (!user) return null; // RequireAuth only renders this with a user
  if (roles.includes(user.role)) return <>{children}</>;
  return (
    <>
      <Alert variant="error" hint="Sign in with an account that has access, or go back to your own page.">
        You do not have access to this page.
      </Alert>
      <p>
        <Link className="btn btn-primary" href={homePathFor(user.role)}>
          Go to your home
        </Link>
      </p>
    </>
  );
}

/**
 * ACC-04: like RequireAuth, plus a role check. A guest goes to login, a user who must change their
 * password goes to /change-password (both handled by RequireAuth), and a user with the wrong role is
 * told so with a link home. Nothing of the protected content is rendered until the check passes.
 * Convenience only: the backend enforces roles on every request.
 */
export function RequireRole({ roles, children }: RequireRoleProps) {
  return (
    <RequireAuth>
      <RoleGate roles={roles}>{children}</RoleGate>
    </RequireAuth>
  );
}
