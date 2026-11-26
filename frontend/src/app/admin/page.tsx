import type { Metadata } from 'next';
import { ComingSoon } from '@/components/ComingSoon';
import { RequireRole } from '@/components/RequireRole';

export const metadata: Metadata = { title: 'Admin | Travel Planning and Booking Platform' };

export default function AdminPage() {
  return (
    <RequireRole roles={['ADMIN']}>
      <ComingSoon title="Admin" description="Manage users, providers and reports." />
    </RequireRole>
  );
}
