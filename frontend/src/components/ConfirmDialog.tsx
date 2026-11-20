'use client';

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface ConfirmDialogProps {
  /** Short question, e.g. "Cancel this booking?". */
  title: string;
  /** What will happen and whether it can be undone. */
  message?: ReactNode;
  /** Label of the confirming button: name the action ("Cancel booking"), never a bare "OK". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for actions that delete or cannot be undone. */
  destructive?: boolean;
  /** True while the confirmed action is running: both buttons are disabled so it cannot be sent twice. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * GEN-03: the one confirmation step every destructive action goes through. A modal alertdialog that
 * opens with focus on the SAFE button (Cancel), keeps focus inside while open, closes on Escape or a
 * click outside (both mean "cancel"), and gives focus back to whatever opened it.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!busy) onCancel();
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

  return (
    <div
      className="confirm-backdrop"
      data-testid="confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
        className="confirm-panel"
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="confirm-title">
          {title}
        </h2>
        {message ? (
          <div id={messageId} className="confirm-message">
            {message}
          </div>
        ) : null}
        <div className="confirm-actions">
          <button ref={cancelRef} type="button" className="btn" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={destructive ? 'btn btn-danger' : 'btn btn-primary'}
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
