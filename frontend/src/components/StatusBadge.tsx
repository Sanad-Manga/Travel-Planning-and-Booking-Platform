export type BadgeTone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

const KNOWN: Record<string, { label: string; tone: BadgeTone }> = {
  // BookingStatus
  PENDING_PAYMENT: { label: 'Awaiting payment', tone: 'warning' },
  CONFIRMED: { label: 'Confirmed', tone: 'success' },
  COMPLETED: { label: 'Completed', tone: 'info' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  // PaymentStatus (CANCELLED is shared)
  REQUIRES_PAYMENT: { label: 'Payment required', tone: 'warning' },
  PROCESSING: { label: 'Processing payment', tone: 'warning' },
  SUCCEEDED: { label: 'Paid', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'error' },
  // RefundStatus (FAILED is shared)
  PENDING: { label: 'Refund pending', tone: 'warning' },
  REFUNDED: { label: 'Refunded', tone: 'success' },
  // FlightStatus (CANCELLED is shared)
  SCHEDULED: { label: 'Scheduled', tone: 'info' },
  DEPARTED: { label: 'Departed', tone: 'neutral' },
};

/** "SOME_NEW_STATUS" becomes "Some new status", so a status added later still reads as words. */
function humanize(status: string): string {
  const words = status.toLowerCase().replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Unknown';
}

export interface StatusBadgeProps {
  /** A backend status value: booking, payment, refund or flight status. */
  status: string | null | undefined;
}

/**
 * GEN-11: one place that turns a backend status into words and a colour. The word is always shown, so the
 * colour never carries the meaning alone. An unknown status is shown as plain words in the neutral tone.
 */
export function StatusBadge({ status }: StatusBadgeProps) {
  const known = status ? KNOWN[status] : undefined;
  const label = known?.label ?? (status ? humanize(status) : 'Unknown');
  const tone = known?.tone ?? 'neutral';
  return <span className={`status-badge status-badge-${tone}`}>{label}</span>;
}
