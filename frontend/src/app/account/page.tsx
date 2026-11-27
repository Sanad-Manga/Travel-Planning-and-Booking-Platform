import type { Metadata } from 'next';
import { RequireAuth } from '@/components/RequireAuth';
import { AccountSections } from '@/features/account/AccountSections';

export const metadata: Metadata = { title: 'Account | Travel Planning and Booking Platform' };

/** ACC-08 / ACC-09: /account, the signed-in user's profile and password. */
export default function AccountPage() {
  return (
    <RequireAuth>
      <AccountSections />
    </RequireAuth>
  );
}
