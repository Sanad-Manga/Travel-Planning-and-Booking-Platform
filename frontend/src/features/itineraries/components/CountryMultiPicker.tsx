'use client';

import { ReferencePicker } from '@/components/ReferencePicker';
import { toFriendlyError } from '@/lib/apiError';
import { useCountries } from '../useCountries';

interface CountryMultiPickerProps {
  value: string[];
  onChange: (codes: string[]) => void;
  error?: string;
}

/** ITN-01: one or more countries from the predefined list. Each pick becomes a removable chip. */
export function CountryMultiPicker({ value, onChange, error }: CountryMultiPickerProps) {
  const { countries, error: loadError, isLoading, nameOf } = useCountries();
  const options = countries
    .filter((country) => !value.includes(country.code))
    .map((country) => ({ value: country.code, label: country.name, detail: country.code }));

  return (
    <div className="country-multi">
      <ReferencePicker
        label="Countries"
        // Not `required`: that would mark the always-empty search box as missing even after countries are chosen.
        hint="Required. Add every country you plan to visit."
        options={options}
        value=""
        onChange={(code) => {
          if (code) onChange([...value, code]);
        }}
        error={error}
        isLoading={isLoading}
        loadError={loadError ? `Could not load the list. ${toFriendlyError(loadError).hint}` : undefined}
        placeholder="Type a country name"
      />
      {value.length > 0 ? (
        <ul className="chip-list" aria-label="Chosen countries">
          {value.map((code) => (
            <li key={code} className="chip">
              <span>{nameOf(code)}</span>
              <button
                type="button"
                className="chip-remove"
                aria-label={`Remove ${nameOf(code)}`}
                onClick={() => onChange(value.filter((other) => other !== code))}
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
