'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { adminProvidersPath, createModerator, type CreateModeratorBody, type CreatedModerator, type Provider } from '@/api/admin';
import { usePaginated } from '@/api/usePaginated';
import { Alert } from '@/components/Alert';
import { useAuth } from '@/components/AuthProvider';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { Card } from '@/components/Card';
import { DataTable, type TableColumn } from '@/components/DataTable';
import { FormActions } from '@/components/FormActions';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { TextField } from '@/components/TextField';
import { ApiError } from '@/lib/api';
import { toFriendlyError } from '@/lib/apiError';
import { applyApiErrors } from '@/lib/formErrors';
import { ModeratorCreatedDialog } from './ModeratorCreatedDialog';
import { moderatorFormSchema, moderatorRoles, type ModeratorForm } from './moderatorFormSchema';
import styles from './moderators.module.css';

const defaults: ModeratorForm = { name: '', email: '', role: '', provider: null, temporaryPassword: '' };
const apiFields = ['name', 'email', 'role', 'temporaryPassword', 'airlineId', 'hotelId'];
const auditFailure = 'Moderator account was created but the audit record failed. Do not create it again; tell the lead.';
type Disclosure = {
  account: CreatedModerator;
  role: CreateModeratorBody['role'];
  providerName: string;
  temporaryPassword: string;
};

export function CreateModeratorClient() {
  const { user } = useAuth();
  return user?.role === 'ADMIN' && !user.mustChangePassword ? <ModeratorFormView key={user.id} /> : null;
}

function ModeratorFormView() {
  const router = useRouter();
  const { register, control, handleSubmit, setValue, setError, clearErrors, reset, resetField, formState } =
    useForm<ModeratorForm, unknown, z.output<typeof moderatorFormSchema>>({
      resolver: zodResolver(moderatorFormSchema), defaultValues: defaults,
    });
  const { errors, isSubmitting } = formState;
  const role = useWatch({ control, name: 'role' });
  const selected = useWatch({ control, name: 'provider' });
  const type = role === 'AIRLINE_MODERATOR' || role === 'HOTEL_MODERATOR' ? moderatorRoles[role].type : undefined;
  const providers = usePaginated<Provider>(type ? adminProvidersPath : null, { type });
  const [disclosure, setDisclosure] = useState<Disclosure | null>(null);
  const [banner, setBanner] = useState('');
  const [requestPending, setRequestPending] = useState(false);
  const submitting = isSubmitting || requestPending;
  const lock = useRef(false);
  const session = useRef<object | null>(null);
  const roleId = useId();
  const providerErrorId = useId();
  const denied = providers.error?.status === 401 || providers.error?.status === 403;
  const providerError = errors.provider?.message ?? errors.provider?.id?.message;
  const listUnavailable = Boolean(type && (providers.error || !providers.data?.total));

  useLayoutEffect(() => {
    session.current = denied ? null : {};
    if (denied) resetField('temporaryPassword');
    return () => { session.current = null; };
  }, [denied, resetField]);
  if (denied && disclosure) setDisclosure(null);

  function leave() {
    if (lock.current) return;
    reset();
    setDisclosure(null);
    router.push('/admin');
  }

  async function submit(values: z.output<typeof moderatorFormSchema>) {
    const owner = session.current;
    if (!owner || lock.current || disclosure || listUnavailable || !values.provider) return;
    lock.current = true;
    setRequestPending(true);
    setBanner('');
    const { name, email, role, provider, temporaryPassword } = values;
    const body: CreateModeratorBody = {
      name, email, role, temporaryPassword,
      ...(role === 'AIRLINE_MODERATOR' ? { airlineId: provider.id } : { hotelId: provider.id }),
    };
    try {
      const account = await createModerator(body);
      if (session.current !== owner) return;
      resetField('temporaryPassword');
      setDisclosure({ account, role, providerName: provider.name, temporaryPassword });
    } catch (error) {
      if (session.current !== owner) return;
      if (error instanceof ApiError && [400, 404, 409].includes(error.status)) {
        if (error.status === 404 && error.details.some(({ field }) => field === 'airlineId' || field === 'hotelId')) {
          setValue('provider', null);
        }
        const safeError = new ApiError(error.status, toFriendlyError({ status: error.status }).message,
          error.details.map(({ field, message }) => ({
            field: field === 'airlineId' || field === 'hotelId' ? 'provider' : field,
            message: apiFields.includes(field) && !message.includes(temporaryPassword)
              ? message : 'Some details could not be accepted. Review the form.',
          })));
        const rest = applyApiErrors(safeError, setError, [...apiFields, 'provider']);
        if (rest) setBanner(rest);
      } else if (error instanceof ApiError && error.message === auditFailure) {
        setBanner(auditFailure);
      } else if (!(error instanceof ApiError) || error.status >= 500) {
        setBanner('The moderator account may have been created. Check whether this email is registered before trying again.');
      } else {
        if (error.status === 401 || error.status === 403) resetField('temporaryPassword');
        setBanner(toFriendlyError({ status: error.status }).message);
      }
    } finally {
      lock.current = false;
      setRequestPending(false);
    }
  }

  const columns: TableColumn<Provider>[] = [
    { id: 'select', header: 'Select', cell: (provider) => (
      <label className={styles.choice}>
        <input type="radio" name="provider-choice" checked={selected?.kind === type && selected?.id === provider.id}
          aria-label={`Select ${provider.name}`}
          onChange={() => {
            if (type) setValue('provider', { ...provider, kind: type }, { shouldValidate: true });
          }} />
      </label>
    ) },
    { id: 'name', header: 'Provider name', cell: ({ name }) => name },
    { id: 'status', header: 'Status', cell: ({ isActive }) => (
      <span className={`status-badge status-badge-${isActive ? 'success' : 'neutral'}`}>{isActive ? 'Active' : 'Inactive'}</span>
    ) },
  ];

  return (
    <div className={styles.page}>
      <Breadcrumbs items={[{ label: 'Admin', href: '/admin' }, { label: 'Create moderator' }]} />
      <PageHeader title="Create moderator" description="Create an account and assign it to an airline or hotel." />
      <Card>
        <form noValidate onSubmit={(event) => void handleSubmit(submit)(event)}>
          <fieldset className={styles.form} disabled={submitting || Boolean(disclosure)}>
            <section className={styles.section} aria-labelledby="moderator-account">
              <h2 id="moderator-account">Account details</h2>
              <div className={styles.details}>
                <TextField label="Full name" required autoComplete="name" maxLength={100}
                  error={errors.name?.message} {...register('name')} />
                <TextField label="Email address" type="email" required autoComplete="email" maxLength={254}
                  error={errors.email?.message} {...register('email')} />
              </div>
            </section>
            <section className={styles.section} aria-labelledby="moderator-role">
              <h2 id="moderator-role">Role and provider</h2>
              <div className="field">
                <label className="field-label" htmlFor={roleId}>Moderator role</label>
                <select className="field-input" id={roleId} required aria-invalid={Boolean(errors.role)}
                  aria-describedby={errors.role ? `${roleId}-error` : undefined}
                  {...register('role', { onChange: () => {
                    setValue('provider', null);
                    clearErrors('provider');
                  } })}>
                  <option value="">Choose a role</option>
                  {Object.entries(moderatorRoles).map(([value, option]) => (
                    <option key={value} value={value}>{option.label}</option>
                  ))}
                </select>
                {errors.role && <p className="field-error" id={`${roleId}-error`}>{errors.role.message}</p>}
              </div>
              {type ? (
                <fieldset className={styles.providers} aria-describedby={providerError ? providerErrorId : undefined}>
                  <legend className="field-label">Select {type === 'airline' ? 'an airline' : 'a hotel'}</legend>
                  {selected?.kind === type && <p className="field-hint">Selected provider: {selected.name}</p>}
                  {providerError && <p id={providerErrorId} className="field-error" role="alert">{providerError}</p>}
                  {errors.provider?.type === 'server' && !providers.error && (
                    <div><button type="button" className="btn" onClick={() => void providers.revalidate()}>
                      Refresh providers
                    </button></div>
                  )}
                  <DataTable caption="Providers" rows={providers.items} columns={columns} rowKey={(provider) => provider.id}
                    isLoading={providers.isLoading} error={providers.error} onRetry={() => void providers.revalidate()}
                    emptyTitle={type === 'airline' ? 'No airlines found' : 'No hotels found'} />
                  {providers.data && providers.data.total > 0 && !providers.error &&
                    <Pagination {...providers.data} onPageChange={providers.setPage} />}
                </fieldset>
              ) : <p className="field-hint">Select a moderator role to load its providers.</p>}
            </section>
            <section className={styles.section} aria-labelledby="moderator-password">
              <h2 id="moderator-password">Temporary password</h2>
              <TextField label="Password" type="password" autoComplete="new-password" required
                hint="Use at least eight characters, including a letter and a digit. Maximum 72 UTF-8 bytes."
                error={errors.temporaryPassword?.message} {...register('temporaryPassword')} />
              <p className="field-hint">The moderator can sign in once within 24 hours and must change the password after signing in.</p>
            </section>
            {banner && <Alert variant="error">{banner}</Alert>}
            <FormActions primaryLabel="Create moderator" submitting={submitting} submittingLabel="Creating moderator…"
              disabled={listUnavailable || Boolean(disclosure)} onCancel={leave} />
          </fieldset>
        </form>
      </Card>
      {disclosure && !denied && <ModeratorCreatedDialog {...disclosure} onDismiss={leave} />}
    </div>
  );
}
