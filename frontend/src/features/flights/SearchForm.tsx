'use client';

import { useState, type FormEvent } from 'react';
import { FormActions } from '@/components/FormActions';
import { AirportPicker } from '@/components/pickers';
import { SelectField } from '@/components/SelectField';
import { TextField } from '@/components/TextField';
import {
  CABIN_CLASSES,
  CABIN_LABELS,
  validateSearchForm,
  type SearchFormErrors,
  type SearchFormValues,
} from './searchParams';

export interface SearchFormProps {
  /** Values already in the address bar: a reload, a shared link or the Back button starts here. */
  initial: SearchFormValues;
  onSearch: (values: SearchFormValues) => void;
}

/**
 * FLT-11: the flight search form. Guests and registered users use the same form. It checks the
 * route, dates and passenger count before a request is made, then hands the validated values to the
 * page, which writes them to the URL.
 */
export function SearchForm({ initial, onSearch }: SearchFormProps) {
  const [values, setValues] = useState<SearchFormValues>(initial);
  const [errors, setErrors] = useState<SearchFormErrors>({});

  function update<K extends keyof SearchFormValues>(field: K, value: SearchFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const normalized: SearchFormValues = {
      ...values,
      departureAirport: values.departureAirport.trim().toUpperCase(),
      arrivalAirport: values.arrivalAirport.trim().toUpperCase(),
      passengers: values.passengers.trim(),
    };
    const found = validateSearchForm(normalized);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setValues(normalized);
    onSearch(normalized);
  }

  return (
    <form className="flight-search-form" onSubmit={submit} noValidate aria-label="Flight search">
      <div className="flight-search-grid">
        <AirportPicker
          label="From"
          placeholder="Departure airport"
          required
          value={values.departureAirport}
          onChange={(value) => update('departureAirport', value)}
          error={errors.departureAirport}
        />
        <AirportPicker
          label="To"
          placeholder="Arrival airport"
          required
          value={values.arrivalAirport}
          onChange={(value) => update('arrivalAirport', value)}
          error={errors.arrivalAirport}
        />
        <TextField
          label="Departure date"
          type="date"
          required
          value={values.departureDate}
          onChange={(event) => update('departureDate', event.target.value)}
          error={errors.departureDate}
        />
        <TextField
          label="Return date"
          type="date"
          hint="Optional. Leave empty for a one-way flight."
          value={values.returnDate}
          onChange={(event) => update('returnDate', event.target.value)}
          error={errors.returnDate}
        />
        <TextField
          label="Passengers"
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          required
          hint="Passengers who need a seat. Infants do not take a seat."
          value={values.passengers}
          onChange={(event) => update('passengers', event.target.value)}
          error={errors.passengers}
        />
        <SelectField
          label="Cabin"
          hint="Optional. Leave on any cabin to compare them all."
          value={values.cabinClass}
          onChange={(event) => update('cabinClass', event.target.value)}
          error={errors.cabinClass}
        >
          <option value="">Any cabin</option>
          {CABIN_CLASSES.map((cabin) => (
            <option key={cabin} value={cabin}>
              {CABIN_LABELS[cabin]}
            </option>
          ))}
        </SelectField>
      </div>
      <FormActions primaryLabel="Search flights" />
    </form>
  );
}
