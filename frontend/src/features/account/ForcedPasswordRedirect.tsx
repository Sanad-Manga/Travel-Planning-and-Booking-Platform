'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { FORCED_PASSWORD_PATH } from '@/lib/roles';

/**
 * ACC-13 / ACC-07a: a moderator or user with a temporary password must set a new one before anything else.
 * RequireAuth already does this on protected pages; this does it on EVERY page (public ones too), so the
 * person cannot browse around first. Mounted once in AppShell; renders nothing. The backend enforces the
 * same rule on its side (only me, change-password and logout work), so this is for the person, not security.
 */
export function ForcedPasswordRedirect() {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const mustMove = !!user?.mustChangePassword && pathname !== FORCED_PASSWORD_PATH;

  useEffect(() => {
    if (mustMove) router.replace(FORCED_PASSWORD_PATH);
  }, [mustMove, router]);

  return null;
}
