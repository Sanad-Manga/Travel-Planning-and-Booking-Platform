import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FormActions } from './FormActions';

describe('FormActions (GEN-15)', () => {
  it('puts the primary button first, then a visible cancel button', () => {
    render(<FormActions primaryLabel="Book now" onCancel={() => undefined} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Book now', 'Cancel']);
    expect(buttons[0]).toHaveClass('btn-primary');
    expect(buttons[0]).toHaveAttribute('type', 'submit');
    expect(buttons[1]).toHaveAttribute('type', 'button');
  });

  it('lets the secondary label be changed and calls onCancel', async () => {
    const onCancel = vi.fn();
    render(<FormActions primaryLabel="Save" cancelLabel="Discard changes" onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('can render the secondary action as a link', () => {
    render(<FormActions primaryLabel="Save" cancelHref="/flights" />);
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/flights');
  });

  it('has no secondary action unless asked for one', () => {
    render(<FormActions primaryLabel="Search flights" />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('is enabled and shows no spinner when idle', () => {
    render(<FormActions primaryLabel="Book now" onCancel={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Book now' })).toBeEnabled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('while submitting the primary button is disabled, busy and shows a spinner', () => {
    render(<FormActions primaryLabel="Book now" submitting submittingLabel="Booking…" onCancel={() => undefined} />);
    const primary = screen.getByRole('button', { name: 'Booking…' });
    expect(primary).toBeDisabled();
    expect(primary).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Booking…');
    expect(primary).toHaveTextContent('Book now');
  });

  it('keeps the cancel button usable while submitting', () => {
    render(<FormActions primaryLabel="Save" submitting onCancel={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  it('can be disabled without a spinner', () => {
    render(<FormActions primaryLabel="Save" disabled />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a submit button submits its form; a type="button" primary calls onPrimary', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const onPrimary = vi.fn();
    const { rerender } = render(
      <form onSubmit={onSubmit}>
        <FormActions primaryLabel="Save" />
      </form>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    rerender(<FormActions primaryLabel="Save" primaryType="button" onPrimary={onPrimary} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });
});
