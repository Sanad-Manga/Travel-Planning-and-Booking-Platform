'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Alert } from '@/components/Alert';
import { FormActions } from '@/components/FormActions';
import { TextField } from '@/components/TextField';
import { ApiError } from '@/lib/api';
import { toFriendlyError, type FriendlyError } from '@/lib/apiError';
import { applyApiErrors } from '@/lib/formErrors';
import { itineraryFormSchema, TITLE_MAX_LENGTH, type ItineraryFormValues } from '../itineraryForm';
import { CountryMultiPicker } from './CountryMultiPicker';

const FIELDS = ['title', 'countryCodes', 'startDate'] as const;

interface ItineraryFormProps {
  defaultValues: ItineraryFormValues;
  submitLabel: string;
  submittingLabel: string;
  cancelHref: string;
  startDateHint: string;
  /** Saves the values. A rejection is shown on the form. */
  onSave: (values: ItineraryFormValues) => Promise<void>;
  /** Keep the button disabled after a success, for a form that leaves the page (so it cannot create twice). */
  leavesOnSave?: boolean;
}

/** The backend may name one list entry ("countryCodes.1"); the form has a single field for the whole list. */
function onFormFields(error: ApiError): ApiError {
  return new ApiError(
    error.statusCode,
    error.message,
    error.details.map(({ field, message }) => ({ field: field.startsWith('countryCodes') ? 'countryCodes' : field, message })),
  );
}

/** The title, countries and start date of an itinerary, shared by "new" and "edit" (ITN-01). */
export function ItineraryForm({ defaultValues, submitLabel, submittingLabel, cancelHref, startDateHint, onSave, leavesOnSave }: ItineraryFormProps) {
  const { register, control, handleSubmit, setError, formState } = useForm<ItineraryFormValues>({
    resolver: zodResolver(itineraryFormSchema),
    defaultValues,
  });
  const { errors, isSubmitting } = formState;
  const [banner, setBanner] = useState<FriendlyError | null>(null);
  const [left, setLeft] = useState(false);

  const submit = handleSubmit(async (values) => {
    setBanner(null);
    try {
      await onSave(values);
      if (leavesOnSave) setLeft(true);
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 400 && error.details.length > 0) {
        const rest = applyApiErrors(onFormFields(error), setError, FIELDS);
        if (rest) setBanner({ message: rest, hint: 'Check what you entered and try again.', fieldErrors: {}, retryable: false });
      } else {
        setBanner(toFriendlyError(error));
      }
    }
  });

  return (
    <form className="auth-form" noValidate onSubmit={(event) => void submit(event)}>
      {banner ? (
        <Alert variant="error" hint={banner.hint} onRetry={banner.retryable ? () => void submit() : undefined}>
          {banner.message}
        </Alert>
      ) : null}
      <TextField
        label="Title"
        required
        maxLength={TITLE_MAX_LENGTH}
        hint={`Up to ${TITLE_MAX_LENGTH} characters.`}
        error={errors.title?.message}
        {...register('title')}
      />
      <Controller
        control={control}
        name="countryCodes"
        render={({ field }) => (
          <CountryMultiPicker value={field.value} onChange={field.onChange} error={errors.countryCodes?.message} />
        )}
      />
      <TextField label="Start date" type="date" required hint={startDateHint} error={errors.startDate?.message} {...register('startDate')} />
      <FormActions
        primaryLabel={submitLabel}
        submitting={isSubmitting}
        submittingLabel={submittingLabel}
        disabled={left}
        cancelHref={cancelHref}
      />
    </form>
  );
}
