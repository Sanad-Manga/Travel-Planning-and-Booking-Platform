import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge (GEN-11)', () => {
  it.each([
    ['PENDING_PAYMENT', 'Awaiting payment', 'warning'],
    ['CONFIRMED', 'Confirmed', 'success'],
    ['COMPLETED', 'Completed', 'info'],
    ['EXPIRED', 'Expired', 'neutral'],
    ['CANCELLED', 'Cancelled', 'neutral'],
    ['REQUIRES_PAYMENT', 'Payment required', 'warning'],
    ['PROCESSING', 'Processing payment', 'warning'],
    ['SUCCEEDED', 'Paid', 'success'],
    ['FAILED', 'Failed', 'error'],
    ['PENDING', 'Refund pending', 'warning'],
    ['REFUNDED', 'Refunded', 'success'],
    ['SCHEDULED', 'Scheduled', 'info'],
    ['DEPARTED', 'Departed', 'neutral'],
  ])('shows %s as "%s" in the %s tone', (status, label, tone) => {
    render(<StatusBadge status={status} />);
    const badge = screen.getByText(label);
    expect(badge).toHaveClass(`status-badge-${tone}`);
  });

  it('turns an unknown status into plain words in the neutral tone', () => {
    render(<StatusBadge status="AWAITING_REVIEW" />);
    expect(screen.getByText('Awaiting review')).toHaveClass('status-badge-neutral');
  });

  it('does not match a status by prefix or case', () => {
    render(<StatusBadge status="confirmed" />);
    expect(screen.getByText('Confirmed')).toHaveClass('status-badge-neutral');
  });

  it('shows "Unknown" for a missing or empty status', () => {
    const { rerender } = render(<StatusBadge status={null} />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    rerender(<StatusBadge status="" />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });
});
