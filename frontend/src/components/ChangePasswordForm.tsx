'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { toFriendlyError, type FriendlyError } from '@/lib/apiError';
import { homePathFor } from '@/lib/roles';
import { Alert } from './Alert';
import { useAuth } from './AuthProvider';
import { Breadcrumbs } from './Breadcrumbs';
import { FormActions } from './FormActions';
import { PageHeader } from './PageHeader';
import { TextField } from './TextField';
import { useToast } from './ToastProvider';

const FIELDS = ['currentPassword', 'newPassword'];

/** The project rule (ACC-08): at least 8 characters, with a letter and a digit. */
function checkNewPassword(value: string): string | undefined {
  if (!value) return 'Enter a new password.';
  if (value.length < 8) return 'Use at least 8 characters.';
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return 'Use at least one letter and one digit.';
  return undefined;
}

/**
 * ACC-11 / ACC-08: change the password. For a user with a temporary password this is the only usable
 * page; the server then ends the session, so after success the person logs in again with the new one.
 */
export function ChangePasswordForm({ embedded = false }: { embedded?: boolean } = {}) {
  const router = useRouter();
  const toast = useToast();
  const { user, login, logout, resetSession } = useAuth();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<FriendlyError | null>(null);

  async function submit() {
    const problems: Record<string, string> = {};
    if (!currentPassword) problems.currentPassword = 'Enter your current password.';
    const weak = checkNewPassword(newPassword);
    if (weak) problems.newPassword = weak;
    else if (newPassword === currentPassword) problems.newPassword = 'Choose a password different from your current password.';
    if (!problems.newPassword && confirm !== newPassword) problems.confirm = 'The passwords do not match.';
    setFieldErrors(problems);
    setFormError(null);
    if (Object.keys(problems).length > 0) return;

    setSubmitting(true);
    try {
      await api('/auth/change-password', { method: 'PATCH', body: { currentPassword, newPassword } });
    } catch (error) {
      const friendly = toFriendlyError(error);
      const known: Record<string, string> = {};
      for (const field of FIELDS) if (friendly.fieldErrors[field]) known[field] = friendly.fieldErrors[field];
      setFieldErrors(known);
      if (Object.keys(known).length === 0) setFormError(friendly);
      setSubmitting(false);
      return;
    }

    // ACC-13 / ACC-07a: a forced change has already ended the session on the server. Sign straight back in
    // with the new password and go to the role's home; if that fails, fall through to "please log in again".
    if (user?.mustChangePassword) {
      try {
        const me = await login(user.email, newPassword);
        toast.success('Password changed.');
        router.replace(homePathFor(me.role));
        return;
      } catch {
        resetSession();
        toast.success('Password changed, please log in again.');
        router.replace('/login');
        return;
      }
    }

    // An ordinary change is ended here so the person signs in with the new password.
    // If that call fails the screen still must not keep the old session.
    try {
      await logout();
    } catch {
      resetSession();
    }
    toast.success('Password changed, please log in again.');
    router.replace('/login');
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  return (
    <>
      {embedded ? (
        // ACC-08: inside a section of /account, which has its own heading.
        <p className="field-hint">Enter your current password and a new one. You will then log in again.</p>
      ) : (
        <>
          <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Change password' }]} />
          <PageHeader title="Change password" description="Choose a new password. You will then log in again." />
        </>
      )}
      <form className="auth-form" onSubmit={onSubmit} noValidate>
        {formError ? (
          <Alert variant="error" hint={formError.hint} onRetry={formError.retryable ? () => void submit() : undefined}>
            {formError.message}
          </Alert>
        ) : null}
        <TextField
          label="Current password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          error={fieldErrors.currentPassword}
        />
        <TextField
          label="New password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters, with a letter and a digit."
          required
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          error={fieldErrors.newPassword}
        />
        <TextField
          label="Confirm new password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          error={fieldErrors.confirm}
        />
        <FormActions primaryLabel="Change password" submitting={submitting} submittingLabel="Changing password…" cancelHref={embedded ? undefined : '/'} />
      </form>
    </>
  );
}
