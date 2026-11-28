import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ModeratorCreatedDialog } from './ModeratorCreatedDialog';

const password = ' Synthetic9Fixture ';
const writeText = vi.fn();
beforeEach(() => {
  writeText.mockReset();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value() { this.open = true; } },
    close: { configurable: true, value() { this.open = false; } },
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function mount() {
  function Host() {
    const [show, setShow] = useState(true);
    return show && <ModeratorCreatedDialog account={{ name: 'Synthetic Moderator', email: 'mod@example.test' }}
      role="HOTEL_MODERATOR" providerName="Fixture Hotel" temporaryPassword={password} onDismiss={() => setShow(false)} />;
  }
  return render(<Host />);
}

it('discloses identity, provider, first-login rules and the exact submitted password with focus on Done', () => {
  mount();
  expect(screen.getByRole('dialog')).toHaveAccessibleDescription(/one login within 24 hours.*must change it/);
  for (const text of ['Synthetic Moderator', 'mod@example.test', 'Hotel moderator', 'Fixture Hotel']) {
    expect(screen.getByText(text)).toBeVisible();
  }
  expect(screen.getByLabelText('Temporary password')).toHaveValue(password);
  expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus();
  expect(writeText).not.toHaveBeenCalled();
});

it('copies on request, announces success and avoids persistent storage', async () => {
  vi.useFakeTimers();
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  mount();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy password' })));
  expect(writeText).toHaveBeenCalledExactlyOnceWith(password);
  expect(screen.getByRole('status')).toHaveTextContent('Password copied.');
  act(() => vi.advanceTimersByTime(1500));
  expect(screen.getByRole('button', { name: 'Copy password' })).toBeVisible();
  expect(storage).not.toHaveBeenCalled();
});

it('keeps the password selectable when clipboard access fails', async () => {
  writeText.mockRejectedValueOnce(new Error('Clipboard unavailable'));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Copy password' }));
  expect(await screen.findByText(/copy it manually/)).toBeVisible();
  expect(screen.getByLabelText('Temporary password')).toHaveValue(password);
});

it.each(['Done', 'Escape'])('removes the disclosed password on %s', (method) => {
  mount();
  if (method === 'Done') fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  else fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByDisplayValue(password)).toBeNull();
});
