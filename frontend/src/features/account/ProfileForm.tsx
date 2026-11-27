'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert } from '@/components/Alert';
import { useAuth } from '@/components/AuthProvider';
import { FormActions } from '@/components/FormActions';
import { CurrencyPicker } from '@/components/pickers';
import { TextField } from '@/components/TextField';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { toFriendlyError, type FriendlyError } from '@/lib/apiError';
import { applyApiErrors } from '@/lib/formErrors';

/** Spaces, dashes, dots and parentheses are typing aids; the backend strips them too (users/dto/phone.ts). */
const stripPhone = (value: string) => value.trim().replace(/[\s\-().]/g, '');

/** The same rules as the backend's UpdateProfileDto (ACC-09), checked before anything is sent. */
const schema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(100, 'Use at most 100 characters.'),
  phone: z
    .string()
    .transform(stripPhone)
    .refine((value) => /^(\+?\d{7,15})?$/.test(value), 'Use 7 to 15 digits, with an optional + at the start.'),
  preferredCurrency: z.string().min(1, 'Choose a currency.'),
});
type Input = z.input<typeof schema>;
type Values = z.output<typeof schema>;
const FIELDS = ['name', 'phone', 'preferredCurrency'] as const;

/**
 * ACC-09: edit name, phone and preferred currency (the currency itinerary budgets are shown in). Saves all
 * three with PATCH /api/users/me only when every field passes, then reloads the signed-in user so the rest
 * of the app sees the change. An empty phone removes the number.
 */
export function ProfileForm() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [formError, setFormError] = useState<FriendlyError | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Input, unknown, Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: user?.name ?? '', phone: user?.phone ?? '', preferredCurrency: user?.preferredCurrency ?? '' },
  });

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api('/users/me', { method: 'PATCH', body: values });
    } catch (error) {
      const rest = applyApiErrors(error, setError, FIELDS);
      if (rest !== null) setFormError(toFriendlyError(error));
      return;
    }
    await refresh();
    toast.success('Profile saved.');
  });

  return (
    <form className="auth-form" onSubmit={(event) => void submit(event)} noValidate>
      {formError ? (
        <Alert variant="error" hint={formError.hint} onRetry={formError.retryable ? () => void submit() : undefined}>
          {formError.message}
        </Alert>
      ) : null}
      <TextField label="Full name" autoComplete="name" required error={errors.name?.message} {...register('name')} />
      <TextField
        label="Phone"
        type="tel"
        autoComplete="tel"
        hint="Optional. 7 to 15 digits, for example +20 100 123 4567. Leave empty to remove it."
        error={errors.phone?.message}
        {...register('phone')}
      />
      <Controller
        control={control}
        name="preferredCurrency"
        render={({ field }) => (
          <CurrencyPicker
            label="Preferred currency"
            hint="Itinerary budgets are shown in this currency."
            required
            name={field.name}
            value={field.value}
            onChange={field.onChange}
            error={errors.preferredCurrency?.message}
          />
        )}
      />
      <FormActions primaryLabel="Save changes" submitting={isSubmitting} submittingLabel="Saving…" />
    </form>
  );
}
