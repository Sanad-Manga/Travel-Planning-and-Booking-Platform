'use client';

import { useAuth } from '@/components/AuthProvider';
import { Card } from '@/components/Card';
import { ChangePasswordForm } from '@/components/ChangePasswordForm';
import { PageHeader } from '@/components/PageHeader';
import { ProfileForm } from './ProfileForm';

/** ACC-08 / ACC-09: the sections of /account. Rendered inside RequireAuth, so there is always a user. */
export function AccountSections() {
  const { user } = useAuth();
  return (
    <>
      <PageHeader title="Your account" description="Your profile, preferred currency and password." />
      <div className="account-sections">
        <Card title="Profile">
          <p className="field-hint">
            Email (cannot be changed): <span className="account-email">{user?.email}</span>
          </p>
          <ProfileForm />
        </Card>
        <Card title="Password">
          <ChangePasswordForm embedded />
        </Card>
        {/* SCRUM-149 (ACC-12): the "Deactivate account" section goes here, as a third Card. */}
      </div>
    </>
  );
}
