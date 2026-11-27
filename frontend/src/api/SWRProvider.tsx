'use client';

import { useState, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { useAuth } from '@/components/AuthProvider';
import { swrDefaults } from './useApi';

/**
 * GEN-02: the app-wide SWR settings (see `useApi`). Mounted once in `layout.tsx`, inside `AuthProvider`.
 *
 * ACC-06: the cache belongs to one session. When a signed-in user logs out, or a different user signs in,
 * the cache is replaced by an empty one (a new `key` remounts SWRConfig with a fresh Map), so nothing the
 * previous user loaded can be shown to the next person. A guest signing in keeps the cache: it only held
 * public data, and the first page load (guest, then the user from /auth/me) must not reload everything.
 */
export function SWRProvider({ children }: { children: ReactNode }) {
  const userId = useAuth().user?.id ?? null;
  const [session, setSession] = useState({ userId, generation: 0 });
  if (session.userId !== userId) {
    // Adjusting state while rendering (React's pattern for "reset when a prop changes").
    setSession({ userId, generation: session.userId === null ? session.generation : session.generation + 1 });
  }
  return (
    <SWRConfig key={session.generation} value={{ ...swrDefaults, provider: () => new Map() }}>
      {children}
    </SWRConfig>
  );
}
