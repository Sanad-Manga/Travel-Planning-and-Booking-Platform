'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { FormActions } from '@/components/FormActions';
import { PageHeader } from '@/components/PageHeader';
import { AirportPicker } from '@/components/pickers';
import { TextField } from '@/components/TextField';
import { useToast } from '@/components/ToastProvider';
import { ApiError } from '@/lib/api';
import { toFriendlyError, type FriendlyError } from '@/lib/apiError';
import { createFlight } from '../api';
import { validateFlight, type FlightFormErrors, type FlightFormValues } from '../flightForm';
import { useAirportZone } from '../useAirportZone';

const EMPTY: FlightFormValues = { flightNumber: '', departureAirport: '', arrivalAirport: '', departureLocalTime: '', arrivalLocalTime: '' };
const FIELDS = Object.keys(EMPTY) as Array<keyof FlightFormValues>;

function zoneHint(airport: string, zone: string | undefined, which: string): string {
  if (!airport) return `Choose the ${which} airport first: this time is local to it.`;
  return zone ? `Local time at ${airport}, time zone ${zone}.` : `Local time at ${airport}.`;
}

/** FLT-03: create a flight. Times are typed in each airport's own local time; the backend converts them to UTC. */
export function CreateFlightForm() {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState<FlightFormValues>(EMPTY);
  const [errors, setErrors] = useState<FlightFormErrors>({});
  const [formError, setFormError] = useState<FriendlyError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const departureZone = useAirportZone(values.departureAirport);
  const arrivalZone = useAirportZone(values.arrivalAirport);

  const set = (field: keyof FlightFormValues) => (value: string) => setValues((current) => ({ ...current, [field]: value }));

  async function submit() {
    const problems = validateFlight(values);
    setErrors(problems);
    setFormError(null);
    if (Object.keys(problems).length > 0) return;

    setSubmitting(true);
    try {
      const flight = await createFlight({ ...values, flightNumber: values.flightNumber.trim() });
      toast.success(`Flight ${values.flightNumber.trim().toUpperCase()} created. Add its cabins next.`);
      router.push(`/airline/flights/${flight.id}`);
    } catch (error) {
      const friendly = toFriendlyError(error);
      const known: FlightFormErrors = {};
      for (const field of FIELDS) if (friendly.fieldErrors[field]) known[field] = friendly.fieldErrors[field];
      // A duplicate flight number is a 409 that still carries `details`, which toFriendlyError only reads on a 400.
      if (error instanceof ApiError) {
        for (const { field, message } of error.details) {
          if ((FIELDS as string[]).includes(field)) known[field as keyof FlightFormValues] = message;
        }
      }
      setErrors(known);
      if (Object.keys(known).length === 0) setFormError(friendly);
      setSubmitting(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  return (
    <>
      <Breadcrumbs items={[{ label: 'Home', href: '/airline' }, { label: 'Flights', href: '/airline/flights' }, { label: 'New flight' }]} />
      <PageHeader title="Create a flight" description="Enter the route and each time in the local time of its airport." />
      <form className="auth-form" onSubmit={onSubmit} noValidate>
        {formError ? (
          <Alert variant="error" hint={formError.hint} onRetry={formError.retryable ? () => void submit() : undefined}>
            {formError.message}
          </Alert>
        ) : null}
        <TextField
          label="Flight number"
          name="flightNumber"
          hint="For example MS777."
          required
          value={values.flightNumber}
          onChange={(event) => set('flightNumber')(event.target.value)}
          error={errors.flightNumber}
        />
        <AirportPicker label="Departure airport" required value={values.departureAirport} onChange={set('departureAirport')} error={errors.departureAirport} />
        <AirportPicker label="Arrival airport" required value={values.arrivalAirport} onChange={set('arrivalAirport')} error={errors.arrivalAirport} />
        <TextField
          label="Departure time"
          name="departureLocalTime"
          type="datetime-local"
          hint={zoneHint(values.departureAirport, departureZone, 'departure')}
          required
          value={values.departureLocalTime}
          onChange={(event) => set('departureLocalTime')(event.target.value)}
          error={errors.departureLocalTime}
        />
        <TextField
          label="Arrival time"
          name="arrivalLocalTime"
          type="datetime-local"
          hint={zoneHint(values.arrivalAirport, arrivalZone, 'arrival')}
          required
          value={values.arrivalLocalTime}
          onChange={(event) => set('arrivalLocalTime')(event.target.value)}
          error={errors.arrivalLocalTime}
        />
        <FormActions primaryLabel="Create flight" submitting={submitting} submittingLabel="Creating flight…" cancelHref="/airline" />
      </form>
    </>
  );
}
