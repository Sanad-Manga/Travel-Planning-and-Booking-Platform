'use client';

import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { swrDefaults } from './useApi';

/** GEN-02: the app-wide SWR settings (see `useApi`). Mounted once in `layout.tsx`. */
export function SWRProvider({ children }: { children: ReactNode }) {
  return <SWRConfig value={swrDefaults}>{children}</SWRConfig>;
}
