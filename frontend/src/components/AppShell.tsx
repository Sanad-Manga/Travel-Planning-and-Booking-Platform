import type { ReactNode } from 'react';
import { ForcedPasswordRedirect } from '@/features/account/ForcedPasswordRedirect';
import { Footer } from './Footer';
import { Header } from './Header';
import { SkipLink } from './SkipLink';

/** GEN-14: skip link, header, the one <main> landmark, footer. Pages render inside <main>, never their own. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <ForcedPasswordRedirect />
      <SkipLink />
      <Header />
      <main id="main-content" tabIndex={-1} className="page app-main">
        {children}
      </main>
      <Footer />
    </div>
  );
}
