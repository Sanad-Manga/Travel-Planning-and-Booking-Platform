import type { Metadata } from 'next';
import Link from 'next/link';
import { ComingSoon } from '@/components/ComingSoon';
import { RequireRole } from '@/components/RequireRole';

export const metadata: Metadata = { title: 'Admin | Travel Planning and Booking Platform' };

export default function AdminPage() {
  return (
    <RequireRole roles={['ADMIN']}>
      <ComingSoon title="Admin" description="Manage users, providers and reports." />
      <Link className="btn btn-primary" href="/admin/moderators/new">Create moderator</Link>
      <Link className="btn" href="/admin/providers">Manage providers</Link>
    </RequireRole>
  );
}
