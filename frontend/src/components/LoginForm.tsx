'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '@/lib/api';
import { toFriendlyError, type FriendlyError } from '@/lib/apiError';
import { safeReturnTo } from '@/lib/returnTo';
import { Alert } from './Alert';
import { useAuth } from './AuthProvider';
import { Breadcrumbs } from './Breadcrumbs';
import { FormActions } from './FormActions';
import { PageHeader } from './PageHeader';
import { Spinner } from './Spinner';
import { TextField } from './TextField';

/** The generic 401/403 wording is about sessions; on the login form the same codes mean something else. */
function describeLoginError(error: unknown): FriendlyError {
  const friendly = toFriendlyError(error);
  if (!(error instanceof ApiError)) return friendly;
  if (error.statusCode === 401) {
    return { ...friendly, message: 'Email or password is incorrect.', hint: 'Check them and try again, or reset your password.' };
  }
  if (error.statusCode === 403) {
    return { ...friendly, message: 'This account is suspended.', hint: 'Contact support if you think this is a mistake.' };
  }
  if (error.statusCode === 423) {
    return {
      ...friendly,
      message: 'This account is locked for 15 minutes after too many failed attempts.',
      hint: 'Try again later, or reset your password.',
    };
  }
  return friendly;
}

/** ACC-10: the login form. After a successful login (or if already logged in) it goes to `returnTo`. */
export function LoginForm() {
  const router = useRouter();
  const returnTo = safeReturnTo(useSearchParams().get('returnTo'));
  const { user, loading, login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<FriendlyError | null>(null);

  useEffect(() => {
    if (!loading && user) router.replace(returnTo);
  }, [loading, user, returnTo, router]);

  async function submit() {
    const trimmed = email.trim();
    const problems: Record<string, string> = {};
    if (!trimmed) problems.email = 'Enter your email address.';
    else if (!/^\S+@\S+\.\S+$/.test(trimmed)) problems.email = 'Enter a valid email address, like name@example.com.';
    if (!password) problems.password = 'Enter your password.';
    setFieldErrors(problems);
    setFormError(null);
    if (Object.keys(problems).length > 0) return;

    setSubmitting(true);
    try {
      await login(trimmed, password);
      // The effect above takes it from here once the user is set.
    } catch (error) {
      const friendly = describeLoginError(error);
      const known: Record<string, string> = {};
      for (const field of ['email', 'password']) {
        if (friendly.fieldErrors[field]) known[field] = friendly.fieldErrors[field];
      }
      setFieldErrors(known);
      if (Object.keys(known).length === 0) {
        setFormError(friendly);
        // A rejected password should not sit in the field; but keep it when the problem was the network,
        // so "Try again" can resubmit.
        if (error instanceof ApiError && error.statusCode === 401) setPassword('');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  if (!loading && user) return <Spinner label="Taking you to your page" />;

  return (
    <>
      <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Login' }]} />
      <PageHeader title="Login" description="Sign in to your account." />
      <form className="auth-form" onSubmit={onSubmit} noValidate>
        {formError ? (
          <Alert variant="error" hint={formError.hint} onRetry={formError.retryable ? () => void submit() : undefined}>
            {formError.message}
          </Alert>
        ) : null}
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrors.email}
        />
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password}
        />
        <FormActions primaryLabel="Log in" submitting={submitting} submittingLabel="Logging in…" cancelHref="/" />
      </form>
      <p className="auth-links">
        <Link href="/register">Create an account</Link>
        <Link href="/forgot-password">Forgot your password?</Link>
      </p>
    </>
  );
}
