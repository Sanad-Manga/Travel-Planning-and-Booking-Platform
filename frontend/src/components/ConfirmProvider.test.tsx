import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ConfirmProvider, useConfirm, type ConfirmOptions } from './ConfirmProvider';

/** Renders a button that asks, and records what `confirm` resolved or rejected with. */
function setup(
  options: ConfirmOptions = {
    title: 'Delete this post?',
    message: 'This cannot be undone.',
    confirmLabel: 'Delete post',
    destructive: true,
  },
) {
  const outcome: { value?: boolean; error?: unknown } = {};
  function Opener() {
    const confirm = useConfirm();
    return (
      <button
        type="button"
        onClick={() => {
          confirm(options).then(
            (value) => (outcome.value = value),
            (error) => (outcome.error = error),
          );
        }}
      >
        Delete
      </button>
    );
  }
  render(
    <ConfirmProvider>
      <Opener />
    </ConfirmProvider>,
  );
  return { outcome, user: userEvent.setup() };
}

describe('ConfirmProvider / ConfirmDialog (GEN-03)', () => {
  it('shows nothing until asked, then an accessible dialog with the title and message', async () => {
    const { user } = setup();
    expect(screen.queryByRole('alertdialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    const dialog = screen.getByRole('alertdialog', { name: 'Delete this post?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('This cannot be undone.');
    expect(screen.getByRole('button', { name: 'Delete post' })).toHaveClass('btn-danger');
  });

  it('opens with focus on the safe Cancel button', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('resolves true on confirm and closes', async () => {
    const { user, outcome } = setup();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete post' }));
    await waitFor(() => expect(outcome.value).toBe(true));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('resolves false on Cancel, on Escape and on a click outside, and gives focus back', async () => {
    const { user, outcome } = setup();
    const opener = screen.getByRole('button', { name: 'Delete' });

    await user.click(opener);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(outcome.value).toBe(false));
    expect(opener).toHaveFocus();

    outcome.value = undefined;
    await user.click(opener);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(outcome.value).toBe(false));
    expect(screen.queryByRole('alertdialog')).toBeNull();

    outcome.value = undefined;
    await user.click(opener);
    await user.click(screen.getByTestId('confirm-backdrop'));
    await waitFor(() => expect(outcome.value).toBe(false));
  });

  it('keeps Tab inside the dialog', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Delete post' });

    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
  });

  it('runs onConfirm with both buttons disabled, then closes and resolves true', async () => {
    let finish: () => void = () => undefined;
    const work = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { user, outcome } = setup({ title: 'Cancel booking?', confirmLabel: 'Cancel booking', onConfirm: () => work });

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Cancel booking' }));

    expect(screen.getByRole('button', { name: 'Cancel booking' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.keyboard('{Escape}'); // cannot be abandoned half way
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(outcome.value).toBeUndefined();

    await act(async () => finish());
    await waitFor(() => expect(outcome.value).toBe(true));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('closes and rejects with the error when onConfirm fails, so the caller can show it', async () => {
    const failure = new Error('server said no');
    const { user, outcome } = setup({
      title: 'Delete?',
      onConfirm: () => Promise.reject(failure),
    });
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(outcome.error).toBe(failure));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('useConfirm outside the provider is a clear error', () => {
    function Lonely() {
      useConfirm();
      return null;
    }
    expect(() => render(<Lonely />)).toThrow('useConfirm must be used inside <ConfirmProvider>');
  });
});
