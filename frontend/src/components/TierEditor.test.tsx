import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { TierEditor } from './TierEditor';

const STORED = [
  { daysBeforeThreshold: 0, refundPercent: 0 },
  { daysBeforeThreshold: 14, refundPercent: 100 },
  { daysBeforeThreshold: 7, refundPercent: 50 },
];

function setup(props: Partial<React.ComponentProps<typeof TierEditor>> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const view = render(<TierEditor tiers={STORED} event="departure" onSave={onSave} {...props} />);
  return { onSave, user: userEvent.setup(), ...view };
}

const daysField = (n: number) => screen.getByLabelText(new RegExp(`^Tier ${n}: days before`));
const percentField = (n: number) => screen.getByLabelText(`Tier ${n}: refund percent`);
const save = () => screen.getByRole('button', { name: /Sav(e|ing) tiers/ });

describe('TierEditor (FLT-09 / HTL-10)', () => {
  it('starts from the stored tiers, largest threshold first', () => {
    setup();
    expect([1, 2, 3].map((n) => (daysField(n) as HTMLInputElement).value)).toEqual(['14', '7', '0']);
    expect([1, 2, 3].map((n) => (percentField(n) as HTMLInputElement).value)).toEqual(['100', '50', '0']);
  });

  it('describes what the saved tiers will do, in words', () => {
    setup();
    const preview = screen.getByRole('heading', { name: 'How it will work' }).parentElement as HTMLElement;
    expect(within(preview).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Cancelling 14 days or more before departure: 100% refund',
      'Cancelling 7 days or more before departure: 50% refund',
      'Any other cancellation before departure: 0% refund',
    ]);
  });

  it('uses "check-in" wording for a hotel', () => {
    setup({ event: 'check-in' });
    expect(screen.getByText('Cancelling 14 days or more before check-in: 100% refund')).toBeInTheDocument();
  });

  it('saves the edited list sorted, with numbers, once', async () => {
    const { onSave, user } = setup();
    await user.clear(percentField(2));
    await user.type(percentField(2), '60');
    await user.click(screen.getByRole('button', { name: 'Add a tier' }));
    await user.type(daysField(4), '30');
    await user.type(percentField(4), '100');
    await user.click(save());
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith([
      { daysBeforeThreshold: 30, refundPercent: 100 },
      { daysBeforeThreshold: 14, refundPercent: 100 },
      { daysBeforeThreshold: 7, refundPercent: 60 },
      { daysBeforeThreshold: 0, refundPercent: 0 },
    ]);
  });

  it('removes a tier and can save an empty list: nothing refunded', async () => {
    const { onSave, user } = setup();
    for (let i = 0; i < 3; i += 1) await user.click(screen.getAllByRole('button', { name: /^Remove tier/ })[0]);
    expect(screen.getByText('No tiers. Nothing is refunded when a booking is cancelled.')).toBeInTheDocument();
    await user.click(save());
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([]));
  });

  it('shows a mistake next to its field, focuses it and sends nothing', async () => {
    const { onSave, user } = setup();
    await user.clear(daysField(2));
    await user.type(daysField(2), '7.5');
    await user.click(save());
    expect(screen.getByText('Use a whole number, like 7.')).toBeInTheDocument();
    expect(daysField(2)).toHaveAttribute('aria-invalid', 'true');
    expect(daysField(2)).toHaveFocus();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('rejects two rows with the same number of days', async () => {
    const { onSave, user } = setup();
    await user.clear(daysField(2));
    await user.type(daysField(2), '14');
    await user.click(save());
    expect(screen.getByText('Row 1 already uses 14 days. Each tier needs its own number of days.')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('stops adding at the maximum', async () => {
    const { user } = setup({ tiers: [] });
    for (let i = 0; i < 20; i += 1) await user.click(screen.getByRole('button', { name: 'Add a tier' }));
    expect(screen.getByRole('button', { name: 'Add a tier' })).toBeDisabled();
    expect(screen.getByText('You can have at most 20 tiers.')).toBeInTheDocument();
  });

  it('puts a server field error on the row the person typed, even though the list was sorted before sending', async () => {
    const body = {
      message: 'Validation failed',
      details: [{ field: 'cancellationTiers.2.daysBeforeThreshold', message: 'daysBeforeThreshold must be 0 or more' }],
    };
    const onSave = vi.fn().mockRejectedValue(new ApiError(400, 'Validation failed', body.details, null, body));
    const user = userEvent.setup();
    // Typed order: 0, 14, 7 -> sent order 14, 7, 0, so sent index 2 is the FIRST row (days 0).
    render(<TierEditor tiers={[]} event="departure" onSave={onSave} />);
    const add = screen.getByRole('button', { name: 'Add a tier' });
    await user.click(add);
    await user.type(daysField(1), '0');
    await user.type(percentField(1), '0');
    await user.click(add);
    await user.type(daysField(2), '14');
    await user.type(percentField(2), '100');
    await user.click(add);
    await user.type(daysField(3), '7');
    await user.type(percentField(3), '50');
    await user.click(save());
    expect(await screen.findByText('daysBeforeThreshold must be 0 or more')).toBeInTheDocument();
    expect(daysField(1)).toHaveAttribute('aria-invalid', 'true');
    expect(daysField(2)).not.toHaveAttribute('aria-invalid');
    expect(daysField(3)).not.toHaveAttribute('aria-invalid');
  });

  it('shows a request failure as an alert with a retry that saves again', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new ApiError(503, 'Service unavailable')).mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<TierEditor tiers={STORED} event="departure" onSave={onSave} />);
    await user.click(save());
    const alert = await screen.findByRole('alert');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('cannot be saved twice while the request runs', async () => {
    let finish: () => void = () => undefined;
    const onSave = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    render(<TierEditor tiers={STORED} event="departure" onSave={onSave} />);
    await user.click(save());
    expect(save()).toBeDisabled();
    await user.click(save());
    expect(onSave).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(save()).toBeEnabled());
  });

  it('calls onCancel from the Cancel button', async () => {
    const onCancel = vi.fn();
    const { user } = setup({ onCancel });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
