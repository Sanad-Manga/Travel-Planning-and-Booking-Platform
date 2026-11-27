'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert } from '@/components/Alert';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { FormActions } from '@/components/FormActions';
import { PageHeader } from '@/components/PageHeader';
import { TextField } from '@/components/TextField';
import { ApiError, api } from '@/lib/api';
import { toFriendlyError, type FriendlyError } from '@/lib/apiError';
import { applyApiErrors } from '@/lib/formErrors';

/** bcrypt uses only the first 72 bytes, so the backend rejects longer passwords. */
const PASSWORD_MAX_BYTES = 72;
const LETTER_AND_DIGIT = 'Use at least one letter and one digit.';

/** The same rules as the backend's RegisterDto (ACC-01), checked before anything is sent. */
const schema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(100, 'Use at most 100 characters.'),
  email: z.string().trim().min(1, 'Enter your email address.').email('Enter a valid email address.').max(254, 'Use at most 254 characters.'),
  password: z
    .string()
    .min(8, 'Use at least 8 characters.')
    .regex(/\p{L}/u, LETTER_AND_DIGIT)
    .regex(/\d/, LETTER_AND_DIGIT)
    .refine((value) => new TextEncoder().encode(value).length <= PASSWORD_MAX_BYTES, 'This password is too long.'),
  acceptTerms: z.boolean().refine((value) => value, 'You must accept the terms and the privacy policy.'),
});
type Values = z.infer<typeof schema>;
const FIELDS = ['name', 'email', 'password', 'acceptTerms'] as const;

/**
 * ACC-01: create an account. Mistakes are shown next to their field, first from the zod checks and then from
 * the backend's `details[]`. Registering does not log the person in: on success the form is replaced by a
 * "check your email" notice (ACC-02 sends the verification link).
 */
export function RegisterForm() {
  const [registered, setRegistered] = useState<string | null>(null);
  const [formError, setFormError] = useState<FriendlyError | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: '', email: '', password: '', acceptTerms: false } });

  const onValid = async (values: Values) => {
    setFormError(null);
    try {
      await api('/auth/register', { method: 'POST', body: values, retryOn401: false, redirectOn401: false });
      setRegistered(values.email);
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 409) {
        setError('email', { type: 'server', message: 'This email is already registered. Log in or use another email.' }, { shouldFocus: true });
        return;
      }
      const rest = applyApiErrors(error, setError, FIELDS);
      if (rest !== null) setFormError(toFriendlyError(error));
    }
  };
  const submit = handleSubmit(onValid);

  if (registered) {
    return (
      <>
        <PageHeader title="Check your email" />
        <Alert variant="success" title="Your account is created.">
          <p>
            We sent a verification link to {registered}. Open it to verify your email; you need that before you can book
            flights or hotels. The link works for 24 hours.
          </p>
          <p>
            <Link className="btn btn-primary" href="/login">
              Log in
            </Link>
          </p>
        </Alert>
      </>
    );
  }

  const termsErrorId = 'register-terms-error';
  return (
    <>
      <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Register' }]} />
      <PageHeader title="Create your account" description="It takes a minute. You can plan trips and book flights and hotels." />
      <form className="auth-form" onSubmit={(event) => void submit(event)} noValidate>
        {formError ? (
          <Alert variant="error" hint={formError.hint} onRetry={formError.retryable ? () => void submit() : undefined}>
            {formError.message}
          </Alert>
        ) : null}
        <TextField label="Full name" autoComplete="name" required error={errors.name?.message} {...register('name')} />
        <TextField label="Email" type="email" autoComplete="email" required error={errors.email?.message} {...register('email')} />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters, with a letter and a digit."
          required
          error={errors.password?.message}
          {...register('password')}
        />
        <div className="field field-check">
          <label className="field-check-label">
            <input
              type="checkbox"
              aria-invalid={errors.acceptTerms ? true : undefined}
              aria-describedby={errors.acceptTerms ? termsErrorId : undefined}
              {...register('acceptTerms')}
            />
            <span>I accept the terms of use and the privacy policy.</span>
          </label>
          {errors.acceptTerms ? (
            <p id={termsErrorId} className="field-error">
              {errors.acceptTerms.message}
            </p>
          ) : null}
        </div>
        <FormActions primaryLabel="Create account" submitting={isSubmitting} submittingLabel="Creating your account…" cancelHref="/" />
      </form>
      <p className="auth-links">
        <Link href="/login">Already have an account? Log in</Link>
      </p>
    </>
  );
}
