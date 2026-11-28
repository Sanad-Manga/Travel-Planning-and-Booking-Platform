'use client';

import { useState, type FormEvent } from 'react';
import type { FlightSearchQuery } from '@/api/flights';
import { SelectField } from '@/components/SelectField';
import { TextField } from '@/components/TextField';
import {
  SORT_OPTIONS,
  centsToPriceInput,
  parseSortChoice,
  priceInputToCents,
  sortChoiceOf,
  type SearchFilters,
} from './searchParams';

export interface ResultsFiltersProps {
  query: FlightSearchQuery;
  /** Applies the refined query: the page writes it to the URL and the results reload. */
  onApply: (query: FlightSearchQuery) => void;
}

interface Errors {
  minPrice?: string;
  maxPrice?: string;
}

/**
 * FLT-15: price range (per passenger, typed in dollars and sent as integer cents) and sort order.
 * Applying keeps the route, dates, passengers and cabin, and goes back to page 1.
 */
export function ResultsFilters({ query, onApply }: ResultsFiltersProps) {
  const [minPrice, setMinPrice] = useState(centsToPriceInput(query.minPrice));
  const [maxPrice, setMaxPrice] = useState(centsToPriceInput(query.maxPrice));
  const [sortChoice, setSortChoice] = useState(sortChoiceOf(query.sort ?? 'departureTime', query.order ?? 'asc'));
  const [errors, setErrors] = useState<Errors>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    const min = priceInputToCents(minPrice);
    const max = priceInputToCents(maxPrice);
    const found: Errors = {};
    if (min === null) found.minPrice = 'Enter a price of 0 or more.';
    if (max === null) found.maxPrice = 'Enter a price of 0 or more.';
    if (min !== null && min !== undefined && max !== null && max !== undefined && min > max) {
      found.minPrice = 'The minimum price cannot be more than the maximum.';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const { sort, order } = parseSortChoice(sortChoice);
    const next: FlightSearchQuery = { ...query, sort, order, page: 1 };
    if (min !== null && min !== undefined) next.minPrice = min;
    else delete next.minPrice;
    if (max !== null && max !== undefined) next.maxPrice = max;
    else delete next.maxPrice;
    onApply(next);
  }

  const filters: Pick<SearchFilters, 'sort' | 'order'> = parseSortChoice(sortChoice);

  return (
    <form className="flight-filters" onSubmit={submit} noValidate aria-label="Filter and sort flights">
      <SelectField label="Sort by" value={sortChoice} onChange={(event) => setSortChoice(event.target.value)}>
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </SelectField>
      <TextField
        label="Min price (USD)"
        type="number"
        min={0}
        step="0.01"
        inputMode="decimal"
        hint="Per passenger."
        value={minPrice}
        onChange={(event) => setMinPrice(event.target.value)}
        error={errors.minPrice}
      />
      <TextField
        label="Max price (USD)"
        type="number"
        min={0}
        step="0.01"
        inputMode="decimal"
        hint="Per passenger."
        value={maxPrice}
        onChange={(event) => setMaxPrice(event.target.value)}
        error={errors.maxPrice}
      />
      <div className="flight-filters-action">
        <button type="submit" className="btn">
          Apply filters
        </button>
        <span className="field-hint" aria-live="polite">
          Sorted by {filters.sort === 'price' ? 'price' : filters.sort === 'duration' ? 'duration' : 'departure time'} (
          {filters.order === 'asc' ? 'ascending' : 'descending'}).
        </span>
      </div>
    </form>
  );
}
