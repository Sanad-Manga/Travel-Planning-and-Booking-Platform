import type { ReactNode } from 'react';

export type AlertVariant = 'info' | 'success' | 'warning' | 'error';

export interface AlertProps {
  variant?: AlertVariant;
  /** Optional bold first line. */
  title?: string;
  /** The message. */
  children: ReactNode;
  /** What to do next, in one sentence (see `toFriendlyError().hint`). */
  hint?: ReactNode;
  /** Shows a "Try again" button that calls this. */
  onRetry?: () => void;
  retryLabel?: string;
  /** Shows a close button that calls this. */
  onClose?: () => void;
}

/**
 * GEN-16: a message inside the page. Errors use role="alert" (announced at once); everything else is
 * role="status" (announced politely). Pass `hint` for the recovery step and `onRetry` for a retry button.
 */
export function Alert({ variant = 'info', title, children, hint, onRetry, retryLabel = 'Try again', onClose }: AlertProps) {
  return (
    <div role={variant === 'error' ? 'alert' : 'status'} className={`alert alert-${variant}`}>
      <div className="alert-body">
        {title ? <p className="alert-title">{title}</p> : null}
        <div className="alert-message">{children}</div>
        {hint ? <p className="alert-hint">{hint}</p> : null}
        {onRetry ? (
          <button type="button" className="btn btn-sm alert-action" onClick={onRetry}>
            {retryLabel}
          </button>
        ) : null}
      </div>
      {onClose ? (
        <button type="button" className="alert-close" aria-label="Dismiss" onClick={onClose}>
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
    </div>
  );
}
