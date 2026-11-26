import type { Metadata } from 'next';
import { ChangePasswordForm } from '@/components/ChangePasswordForm';
import { RequireAuth } from '@/components/RequireAuth';

export const metadata: Metadata = { title: 'Change password | Travel Planning and Booking Platform' };

export default function ChangePasswordPage() {
  // allowMustChange: this is the one page a user with a temporary password may use.
  // A guest goes to plain /login: there is nothing to come back to once the session is gone.
  return (
    <RequireAuth allowMustChange resumeAfterLogin={false}>
      <ChangePasswordForm />
    </RequireAuth>
  );
}
