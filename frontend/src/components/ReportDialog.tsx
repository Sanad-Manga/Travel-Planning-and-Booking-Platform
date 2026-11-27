'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { api } from '@/lib/api';
import {
  REPORT_REASON_MAX_LENGTH,
  REPORT_TARGET_NOUN,
  checkReason,
  classifyReportError,
  type ReportRefusal,
  type ReportTargetType,
} from '@/lib/reports';
import { Alert } from './Alert';
import { FormActions } from './FormActions';

export interface ReportDialogProps {
  targetType: ReportTargetType;
  /** The id of the post, comment, review or itinerary being reported. */
  targetId: string;
  /** Called when the dialog should go away (Cancel, Close, Escape, or a click outside while nothing is being sent). */
  onClose: () => void;
  /** Called once, after the report was saved or the backend said it was already reported. */
  onReported?: () => void;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * GEN-09: lets a signed-in person report a post, comment, review or itinerary with a reason. Render it while it
 * should be open (`{open ? <ReportDialog … /> : null}`), from any page. The reason is required (up to 500 characters).
 * The backend allows one report per person per item: a second try is shown as "already reported", not as a failure.
 * A modal dialog: focus starts in the reason box, stays inside, and goes back to the button that opened it.
 */
export function ReportDialog({ targetType, targetId, onClose, onReported }: ReportDialogProps) {
  const noun = REPORT_TARGET_NOUN[targetType];
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [refusal, setRefusal] = useState<ReportRefusal | null>(null);
  const [done, setDone] = useState<'sent' | 'already-reported' | 'gone' | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const reasonId = useId();
  const hintId = `${reasonId}-hint`;
  const errorId = `${reasonId}-error`;

  const alive = useRef(false);
  const resultId = useId();

  useEffect(() => {
    alive.current = true;
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      alive.current = false;
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, []);

  useEffect(() => {
    reasonRef.current?.focus();
  }, []);

  // After a failed check, put the cursor back in the reason box; once the result is shown, on the Close button.
  useEffect(() => {
    if (attempt > 0) reasonRef.current?.focus();
  }, [attempt]);
  useEffect(() => {
    if (done) closeRef.current?.focus();
  }, [done]);
  // Sending disables the box and may remove the focused button; when it ends without a result, do not leave focus on the page behind
  // (Escape and Tab only work from inside the dialog).
  useEffect(() => {
    if (!busy && !done && !panelRef.current?.contains(document.activeElement)) reasonRef.current?.focus();
  }, [busy, done]);

  async function submit() {
    const problem = checkReason(reason);
    setFieldError(problem);
    setRefusal(null);
    if (problem) {
      setAttempt((count) => count + 1);
      return;
    }
    setBusy(true);
    try {
      await api('/api/reports', { method: 'POST', body: { targetType, targetId, reason: reason.trim() } });
      if (!alive.current) return; // the page went away while sending: do not call back into it
      setDone('sent');
      onReported?.();
    } catch (error) {
      if (!alive.current) return;
      const result = classifyReportError(error, noun);
      if (result.kind === 'already-reported') {
        setDone('already-reported');
        onReported?.();
      } else if (result.kind === 'gone') {
        setDone('gone');
      } else if (result.kind === 'field') {
        setFieldError(result.message);
        setAttempt((count) => count + 1);
      } else {
        setRefusal(result);
      }
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!busy) onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !panelRef.current?.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !panelRef.current?.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  const describedBy = [hintId, fieldError ? errorId : null].filter(Boolean).join(' ');

  return (
    <div
      className="confirm-backdrop"
      data-testid="report-backdrop"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        // Stop the browser moving focus to the page behind; otherwise it wins over returning focus to the opener.
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="confirm-panel" onKeyDown={onKeyDown}>
        <h2 id={titleId} className="confirm-title">
          Report this {noun}
        </h2>

        {done ? (
          <>
            <div id={resultId}>
              {done === 'sent' ? (
                <Alert variant="success" title="Thank you">
                  <p>We received your report. Our team will review this {noun}.</p>
                </Alert>
              ) : null}
              {done === 'already-reported' ? (
                <Alert variant="info" title="Already reported">
                  <p>You have already reported this {noun}. Our team will look at it.</p>
                </Alert>
              ) : null}
              {done === 'gone' ? (
                <Alert variant="warning" title="Not available">
                  <p>This {noun} is no longer available, so it cannot be reported.</p>
                </Alert>
              ) : null}
            </div>
            <div className="confirm-actions">
              <button ref={closeRef} type="button" className="btn btn-primary" aria-describedby={resultId} onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <div className="field">
              <label className="field-label" htmlFor={reasonId}>
                Why are you reporting this {noun}?
                <span className="field-required" aria-hidden="true">
                  *
                </span>
              </label>
              <p id={hintId} className="field-hint">
                Up to {REPORT_REASON_MAX_LENGTH} characters. Only our moderators see your reason.
              </p>
              <textarea
                ref={reasonRef}
                id={reasonId}
                className="field-input"
                rows={5}
                required
                value={reason}
                disabled={busy}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={describedBy}
                onChange={(event) => {
                  setReason(event.target.value);
                  if (fieldError) setFieldError(undefined);
                }}
              />
              {fieldError ? (
                <p id={errorId} className="field-error">
                  {fieldError}
                </p>
              ) : null}
            </div>

            {refusal && refusal.kind === 'other' ? (
              <Alert variant="error" hint={refusal.hint} onRetry={refusal.retryable ? () => void submit() : undefined}>
                {refusal.message}
              </Alert>
            ) : null}

            <FormActions primaryLabel="Send report" submitting={busy} submittingLabel="Sending report…" onCancel={busy ? undefined : onClose} />
          </form>
        )}
      </div>
    </div>
  );
}
