'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { ProviderType } from '@/api/admin';
import { createAirline } from '@/api/airlines';
import { createHotel } from '@/api/hotels';
import type { City, Country } from '@/api/referenceData';
import { usePaginated } from '@/api/usePaginated';
import { Alert } from '@/components/Alert';
import { Card } from '@/components/Card';
import { FormActions } from '@/components/FormActions';
import { Pagination } from '@/components/Pagination';
import { ReferencePicker, type PickerOption } from '@/components/ReferencePicker';
import { TextField } from '@/components/TextField';
import { ApiError } from '@/lib/api';
import { toFriendlyError } from '@/lib/apiError';
import { applyApiErrors } from '@/lib/formErrors';
import { providerFormSchema, type ProviderDraft, type ProviderFormValues } from './providerFormSchema';
import styles from './providers.module.css';

type FormProps = {
  type: ProviderType;
  onTypeChange: (type: ProviderType) => void;
  onCancel: () => void;
  onCreated: (type: ProviderType) => Promise<void>;
  onUncertain: (type: ProviderType) => Promise<void>;
};

type ReferenceFieldProps = {
  label: 'Country' | 'City';
  value: string;
  choose: (value: string) => void;
  error?: string;
  disabled?: boolean;
  countryCode?: string;
};

function ReferenceField({ label, value, choose, error, disabled, countryCode }: ReferenceFieldProps) {
  const country = label === 'Country';
  const page = usePaginated<Country | City>(country ? '/api/countries' : countryCode ? '/api/cities' : null, { countryCode });
  const [selected, setSelected] = useState<PickerOption | undefined>();
  const options: PickerOption[] = page.items.map((item) => 'code' in item
    ? { value: item.code, label: item.name, detail: item.code }
    : { value: item.cityId, label: item.name, detail: item.countryCode });
  if (selected?.value === value && !options.some((option) => option.value === value)) options.unshift(selected);
  const failure = page.error && toFriendlyError(page.error);

  return (
    <div className={styles.reference} role="group" aria-label={`${label} selection`}>
      <ReferencePicker label={label} required value={value} disabled={disabled}
        options={options} isLoading={page.isLoading} error={error}
        hint={!country && !countryCode ? 'Select a country first.' : undefined}
        notice={page.data && page.data.totalPages > 1 ? 'Search this page or use pagination to browse more options.' : undefined}
        onChange={(next) => {
          setSelected(options.find((option) => option.value === next));
          choose(next);
        }} />
      {failure && <Alert variant="error" hint={failure.hint} onRetry={() => void page.revalidate()}>{failure.message}</Alert>}
      {page.data && !failure && page.data.totalPages > 1 && (
        <Pagination {...page.data} onPageChange={page.setPage} />
      )}
    </div>
  );
}

export function CreateProviderForm({ type, onTypeChange, onCancel, onCreated, onUncertain }: FormProps) {
  const { register, control, setValue, setError, clearErrors, handleSubmit, formState } =
    useForm<ProviderFormValues, unknown, ProviderDraft>({
      resolver: zodResolver(providerFormSchema),
      defaultValues: { type, name: '', code: '', address: '', countryCode: '', cityId: '', description: '', starRating: '', amenities: '' },
    });
  const { errors, isSubmitting } = formState;
  const [countryCode, cityId] = useWatch({ control, name: ['countryCode', 'cityId'] });
  const [pending, setPending] = useState(false);
  const [banner, setBanner] = useState('');
  const locked = useRef(false);
  const selector = useRef<HTMLSelectElement>(null);
  const submitting = isSubmitting || pending;

  useEffect(() => { selector.current?.focus(); }, []);

  async function submit(draft: ProviderDraft) {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    setBanner('');
    try {
      if (draft.type === 'airline') await createAirline(draft.body);
      else await createHotel(draft.body);
      await onCreated(draft.type);
    } catch (error) {
      const friendly = toFriendlyError(error);
      if (!friendly.status || friendly.status >= 500) {
        setBanner('The provider may have been created. Check the refreshed list before trying again.');
        await onUncertain(draft.type);
      } else if (error instanceof ApiError && (error.status === 400 || error.status === 409)) {
        if (draft.type === 'hotel' && error.status === 409 && error.details.length === 0) {
          setError('name', { type: 'server', message: friendly.message });
        } else {
          const fields = draft.type === 'airline' ? ['name', 'code']
            : ['name', 'address', 'cityId', 'description', 'starRating', 'amenities'];
          const detailError = new ApiError(error.status, error.message, error.details.map((detail) =>
            detail.field.startsWith('amenities.') ? { ...detail, field: 'amenities' } : detail));
          const rest = applyApiErrors(detailError, setError, fields);
          if (rest) setBanner(rest);
        }
      } else {
        setBanner(friendly.message);
      }
    } finally {
      locked.current = false;
      setPending(false);
    }
  }

  const textarea = (name: 'description' | 'amenities', label: string, hint?: string) => (
    <div className={`field ${styles.wide}`}>
      <label className="field-label" htmlFor={`provider-${name}`}>{label}</label>
      {hint && <p id={`provider-${name}-hint`} className="field-hint">{hint}</p>}
      <textarea className="field-input" id={`provider-${name}`} rows={3} required={name === 'description'}
        aria-invalid={Boolean(errors[name])}
        aria-describedby={[hint ? `provider-${name}-hint` : '', errors[name] ? `provider-${name}-error` : ''].filter(Boolean).join(' ') || undefined}
        {...register(name)} />
      {errors[name] && <p id={`provider-${name}-error`} className="field-error">{errors[name].message}</p>}
    </div>
  );

  return (
    <Card title="Create provider">
      <form noValidate onSubmit={(event) => void handleSubmit(submit)(event)}>
        <fieldset className={styles.fieldset} disabled={submitting} aria-label="Provider details">
          <div className={styles.fields}>
            <label className="field">
              <span className="field-label">New provider type</span>
              <select className="field-input" ref={selector} value={type}
                onChange={(event) => { if (!locked.current) onTypeChange(event.target.value === 'hotel' ? 'hotel' : 'airline'); }}>
                <option value="airline">Airline</option>
                <option value="hotel">Hotel</option>
              </select>
            </label>
            <TextField label={type === 'airline' ? 'Airline name' : 'Hotel name'} required
              error={errors.name?.message} {...register('name')} />
            {type === 'airline' ? (
              <TextField label="Airline code" required autoCapitalize="characters"
                hint="Use 2 or 3 ASCII letters or digits." error={errors.code?.message} {...register('code')} />
            ) : (
              <>
                <TextField label="Address" required error={errors.address?.message} {...register('address')} />
                <div className="field">
                  <label className="field-label" htmlFor="provider-rating">Star rating</label>
                  <select id="provider-rating" className="field-input" required aria-invalid={Boolean(errors.starRating)}
                    aria-describedby={errors.starRating ? 'provider-rating-error' : undefined} {...register('starRating')}>
                    <option value="">Select a rating</option>
                    {[1, 2, 3, 4, 5].map((rating) => <option key={rating} value={rating}>{rating}</option>)}
                  </select>
                  {errors.starRating && <p className="field-error" id="provider-rating-error">{errors.starRating.message}</p>}
                </div>
                <ReferenceField label="Country" value={countryCode} error={errors.countryCode?.message}
                  disabled={submitting} choose={(code) => {
                    if (countryCode === code) return;
                    setValue('countryCode', code, { shouldValidate: true });
                    setValue('cityId', '');
                    clearErrors('cityId');
                  }} />
                <ReferenceField key={countryCode} label="City" countryCode={countryCode} value={cityId}
                  disabled={submitting || !countryCode} error={errors.cityId?.message}
                  choose={(id) => setValue('cityId', id, { shouldValidate: true })} />
                {textarea('description', 'Description')}
                {textarea('amenities', 'Amenities (optional)', 'Separate amenities with commas or new lines.')}
              </>
            )}
          </div>
          {banner && <Alert variant="error">{banner}</Alert>}
          <FormActions primaryLabel={type === 'airline' ? 'Create airline' : 'Create hotel'}
            submitting={submitting} submittingLabel="Creating provider…" onCancel={onCancel} />
        </fieldset>
      </form>
    </Card>
  );
}
