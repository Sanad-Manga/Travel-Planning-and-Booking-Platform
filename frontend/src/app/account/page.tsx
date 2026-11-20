import type { Metadata } from 'next';
import { ComingSoon } from '@/components/ComingSoon';
import { RequireAuth } from '@/components/RequireAuth';

export const metadata: Metadata = { title: 'Account | Travel Planning and Booking Platform' };

export default function AccountPage() {
  return (
    <RequireAuth>
      <ComingSoon title="Account" description="Your profile and settings." />
    </RequireAuth>
  );
}
