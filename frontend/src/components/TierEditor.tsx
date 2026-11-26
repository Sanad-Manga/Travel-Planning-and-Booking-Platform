'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { toFriendlyError, type FriendlyError } from '@/lib/apiError';
import {
  MAX_TIERS,
  describeTier,
  parseTierRows,
  type CancellationTier,
  type TierRowErrors,
} from '@/lib/cancellationTiers';
import { Alert } from './Alert';
import { FormActions } from './FormActions';
import { TextField } from './TextField';

export interface TierEditorProps {
  /** The tiers stored now (any order). The form starts from these. */
  tiers: readonly CancellationTier[];
  /** What the days count back from: "departure" for an airline, "check-in" for a hotel. */
  event: 'departure' | 'check-in';
  /** Saves the full list (sorted, largest threshold first). Throw (an `ApiError`) to show the failure in the form. */
  onSave: (tiers: CancellationTier[]) => Promise<void>;
  onCancel?: () => void;
  saveLabel?: string;
}

interface Row {
  key: number;
  days: string;
  percent: string;
}

/**
 * FLT-09 / HTL-10: edit a provider's cancellation refund tiers. Each row says "cancel N or more days before
 * departure, get P% back". The rules match the backend (whole numbers, days 0-365, percent 0-100, one row per
 * number of days, at most 20 rows), and a mistake is shown next to its field before anything is sent. An empty
 * list is allowed and means nothing is refunded. The caller does the request in `onSave`; the refund amount is
 * calculated by the server, never here.
 */
export function TierEditor({ tiers, event, onSave, onCancel, saveLabel = 'Save tiers' }: TierEditorProps) {
  const nextKey = useRef(tiers.length);
  const [rows, setRows] = useState<Row[]>(() =>
    [...tiers]
      .sort((a, b) => b.daysBeforeThreshold - a.daysBeforeThreshold)
      .map((tier, index) => ({ key: index, days: String(tier.daysBeforeThreshold), percent: String(tier.refundPercent) })),
  );
  const [errors, setErrors] = useState<Record<number, TierRowErrors>>({});
  const [listError, setListError] = useState<string | undefined>();
  const [formError, setFormError] = useState<FriendlyError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (attempt > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempt]);

  function update(key: number, field: 'days' | 'percent', value: string) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  }

  function remove(key: number) {
    setRows((current) => current.filter((row) => row.key !== key));
    setErrors({});
    setListError(undefined);
  }

  function add() {
    const key = nextKey.current++;
    setRows((current) => [...current, { key, days: '', percent: '' }]);
    setListError(undefined);
  }

  async function submit() {
    const result = parseTierRows(rows);
    setFormError(null);
    setErrors(result.errors);
    setListError(result.listError);
    if (Object.keys(result.errors).length > 0 || result.listError) {
      setAttempt((count) => count + 1);
      return;
    }
    setSubmitting(true);
    try {
      await onSave(result.tiers);
    } catch (error) {
      const friendly = toFriendlyError(error);
      const fromServer: Record<number, TierRowErrors> = {};
      rows.forEach((_, rowIndex) => {
        const sent = result.order[rowIndex];
        const days = friendly.fieldErrors[`cancellationTiers.${sent}.daysBeforeThreshold`];
        const percent = friendly.fieldErrors[`cancellationTiers.${sent}.refundPercent`];
        if (days || percent) fromServer[rowIndex] = { days, percent };
      });
      setErrors(fromServer);
      if (Object.keys(fromServer).length === 0) setFormError(friendly);
      else setAttempt((count) => count + 1);
    } finally {
      setSubmitting(false);
    }
  }

  function onSubmit(submitEvent: FormEvent) {
    submitEvent.preventDefault();
    void submit();
  }

  const preview = parseTierRows(rows);
  const previewable = Object.keys(preview.errors).length === 0 && !preview.listError;

  return (
    <form ref={formRef} className="tier-editor" onSubmit={onSubmit} noValidate>
      <fieldset className="tier-editor-fieldset" disabled={submitting}>
        <legend className="tier-editor-legend">Cancellation refund tiers</legend>
        <p className="field-hint">
          Each tier says how much of the booking total is refunded when a traveler cancels at least that many whole days before {event}
          {' '}(0 to 365 days, refund 0 to 100 percent). The largest matching number of days applies.
        </p>

        {formError ? (
          <Alert variant="error" hint={formError.hint} onRetry={formError.retryable ? () => void submit() : undefined}>
            {formError.message}
          </Alert>
        ) : null}

        {rows.length === 0 ? <p className="tier-editor-empty">No tiers. Nothing is refunded when a booking is cancelled.</p> : null}

        <ol className="tier-editor-rows">
          {rows.map((row, index) => (
            <li key={row.key} className="tier-editor-row">
              <TextField
                label={`Tier ${index + 1}: days before ${event}`}
                inputMode="numeric"
                autoComplete="off"
                value={row.days}
                onChange={(changeEvent) => update(row.key, 'days', changeEvent.target.value)}
                error={errors[index]?.days}
              />
              <TextField
                label={`Tier ${index + 1}: refund percent`}
                inputMode="numeric"
                autoComplete="off"
                value={row.percent}
                onChange={(changeEvent) => update(row.key, 'percent', changeEvent.target.value)}
                error={errors[index]?.percent}
              />
              <button type="button" className="btn btn-sm" onClick={() => remove(row.key)} aria-label={`Remove tier ${index + 1}`}>
                Remove
              </button>
            </li>
          ))}
        </ol>

        {listError ? (
          <p role="alert" className="field-error">
            {listError}
          </p>
        ) : null}

        <button type="button" className="btn btn-sm" onClick={add} disabled={rows.length >= MAX_TIERS}>
          Add a tier
        </button>
        {rows.length >= MAX_TIERS ? <p className="field-hint">You can have at most {MAX_TIERS} tiers.</p> : null}

        {previewable && rows.length > 0 ? (
          <div className="tier-editor-preview">
            <h3>How it will work</h3>
            <ul>
              {preview.tiers.map((tier) => (
                <li key={tier.daysBeforeThreshold}>{describeTier(tier, event)}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </fieldset>

      <FormActions primaryLabel={saveLabel} submitting={submitting} submittingLabel="Saving tiers…" onCancel={onCancel} />
    </form>
  );
}
