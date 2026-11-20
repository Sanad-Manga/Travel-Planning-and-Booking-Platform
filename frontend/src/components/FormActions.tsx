import Link from 'next/link';
import { Spinner } from './Spinner';

export interface FormActionsProps {
  /** A verb phrase: "Book now", "Save changes", "Search flights". */
  primaryLabel: string;
  /** `submit` (default) submits the surrounding form; `button` calls `onPrimary`. */
  primaryType?: 'submit' | 'button';
  onPrimary?: () => void;
  /** True while the request is running: disables the primary button and shows a spinner. */
  submitting?: boolean;
  /** Read out while submitting: "Booking…". */
  submittingLabel?: string;
  disabled?: boolean;
  cancelLabel?: string;
  /** Give either `onCancel` (a button) or `cancelHref` (a link); with neither there is no secondary action. */
  onCancel?: () => void;
  cancelHref?: string;
}

/**
 * GEN-15: the end of a form. The primary action comes first and stands out; a plain secondary
 * "Cancel" is always visible so nobody is trapped. The primary button cannot be pressed twice
 * while a request is running.
 */
export function FormActions({
  primaryLabel,
  primaryType = 'submit',
  onPrimary,
  submitting = false,
  submittingLabel,
  disabled = false,
  cancelLabel = 'Cancel',
  onCancel,
  cancelHref,
}: FormActionsProps) {
  return (
    <div className="form-actions">
      <button
        type={primaryType}
        className="btn btn-primary"
        disabled={disabled || submitting}
        aria-busy={submitting || undefined}
        onClick={primaryType === 'button' ? onPrimary : undefined}
      >
        {submitting ? (
          <>
            <Spinner size="sm" label={submittingLabel ?? 'Working…'} />
            <span aria-hidden="true" className="form-actions-label">
              {primaryLabel}
            </span>
          </>
        ) : (
          primaryLabel
        )}
      </button>
      {cancelHref ? (
        <Link className="btn" href={cancelHref}>
          {cancelLabel}
        </Link>
      ) : onCancel ? (
        <button type="button" className="btn" onClick={onCancel}>
          {cancelLabel}
        </button>
      ) : null}
    </div>
  );
}
