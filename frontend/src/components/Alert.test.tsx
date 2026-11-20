import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Alert } from './Alert';

describe('Alert (GEN-16)', () => {
  it('uses role="alert" for errors', () => {
    render(<Alert variant="error">Could not save</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save');
    expect(screen.getByRole('alert')).toHaveClass('alert-error');
  });

  it.each(['info', 'success', 'warning'] as const)('uses role="status" for %s', (variant) => {
    render(<Alert variant={variant}>Heads up</Alert>);
    expect(screen.getByRole('status')).toHaveClass(`alert-${variant}`);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('defaults to info', () => {
    render(<Alert>Hello</Alert>);
    expect(screen.getByRole('status')).toHaveClass('alert-info');
  });

  it('shows a title and a recovery hint', () => {
    render(
      <Alert variant="error" title="Payment failed" hint="Check your card and try again.">
        Your card was declined.
      </Alert>,
    );
    expect(screen.getByText('Payment failed')).toBeInTheDocument();
    expect(screen.getByText('Check your card and try again.')).toBeInTheDocument();
  });

  it('offers a Try again button that calls back', async () => {
    const onRetry = vi.fn();
    render(
      <Alert variant="error" onRetry={onRetry}>
        Network down
      </Alert>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('lets the action label be changed and has no button without onRetry', () => {
    const { rerender } = render(
      <Alert variant="error" onRetry={() => undefined} retryLabel="Reload results">
        Oops
      </Alert>,
    );
    expect(screen.getByRole('button', { name: 'Reload results' })).toBeInTheDocument();
    rerender(<Alert variant="error">Oops</Alert>);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a close button when onClose is given', async () => {
    const onClose = vi.fn();
    render(<Alert onClose={onClose}>Saved</Alert>);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
