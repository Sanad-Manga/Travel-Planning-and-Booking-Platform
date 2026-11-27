'use client';

import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { ResendVerification } from './ResendVerification';

/**
 * ACC-02: under the header, only for a signed-in user whose email is not verified (`emailVerified === false`).
 * Booking and holding answer 403 until then, so it says why and offers a new link. Hidden on /verify-email
 * (that page shows the result itself) and while a temporary password must be changed first.
 */
export function VerifyEmailBanner() {
  const pathname = usePathname();
  const { user } = useAuth();
  if (!user || user.emailVerified !== false || user.mustChangePassword || pathname === '/verify-email') return null;
  return (
    <div className="verify-banner">
      <div className="verify-banner-inner">
        <p className="verify-banner-text">
          <strong>Verify your email to book flights and hotels.</strong> Open the link we sent to {user.email}.
        </p>
        <ResendVerification />
      </div>
    </div>
  );
}
