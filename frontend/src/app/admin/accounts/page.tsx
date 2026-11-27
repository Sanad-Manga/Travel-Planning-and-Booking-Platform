import type { Metadata } from 'next';
import { RequireRole } from '@/components/RequireRole';
import { AccountsClient } from './AccountsClient';

export const metadata: Metadata = { title: 'Accounts | Admin | Travel Planning and Booking Platform' };

export default function AccountsPage() {
  return (
    <RequireRole roles={['ADMIN']}>
      <AccountsClient />
    </RequireRole>
  );
}
