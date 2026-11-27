import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TemporaryPasswordDialog } from './TemporaryPasswordDialog';

const result = { id: 'fixture', temporaryPassword: 'test-only-value', expiresAt: '2026-11-28T12:00:00Z' };
function mount() {
  function Host() {
    const [open, setOpen] = useState(true);
    return open && <TemporaryPasswordDialog account={{ name: 'Sam Test', email: 'sam@example.test' }}
      result={result} onDismiss={() => setOpen(false)} />;
  }
  return render(<Host />);
}

const clipboard = vi.fn();
beforeEach(() => {
  clipboard.mockReset();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } });
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value() { this.open = true; } },
    close: { configurable: true, value() { this.open = false; } },
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('shows the account, expiration, selectable secret and one-time warning with focus on Done', () => {
  mount();
  expect(screen.getByRole('dialog', { name: 'Temporary password generated' })).toHaveAccessibleDescription(/displayed only once/);
  expect(screen.getByText('Sam Test')).toBeVisible();
  expect(screen.getByText('sam@example.test')).toBeVisible();
  expect(document.querySelector('time')).toHaveAttribute('datetime', result.expiresAt);
  expect(screen.getByLabelText('Temporary password')).toHaveValue(result.temporaryPassword);
  expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus();
  expect(clipboard).not.toHaveBeenCalled();
});

it('copies only on request, announces success, and resets the label after 1.5 seconds', async () => {
  vi.useFakeTimers();
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  mount();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy password' })));
  expect(clipboard).toHaveBeenCalledExactlyOnceWith(result.temporaryPassword);
  expect(screen.getByRole('status')).toHaveTextContent('Password copied.');
  expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible();
  act(() => vi.advanceTimersByTime(1500));
  expect(screen.getByRole('button', { name: 'Copy password' })).toBeVisible();
  expect(storage).not.toHaveBeenCalled();
});

it('keeps the value selectable when the clipboard is unavailable', async () => {
  clipboard.mockRejectedValue(new Error('denied'));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Copy password' }));
  expect(await screen.findByText(/copy it manually/)).toBeVisible();
  expect(screen.getByDisplayValue(result.temporaryPassword)).toBeVisible();
  expect(screen.queryByText('Copied')).toBeNull();
});

it.each(['Done', 'Escape'])('removes the secret on %s', (method) => {
  mount();
  if (method === 'Done') fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  else fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(screen.queryByDisplayValue(result.temporaryPassword)).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
});
