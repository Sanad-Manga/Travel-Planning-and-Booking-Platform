import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from './ToastProvider';

function Buttons() {
  const toast = useToast();
  return (
    <>
      <button onClick={() => toast.success('Booking saved')}>ok</button>
      <button onClick={() => toast.error('Could not save')}>fail</button>
      <button onClick={() => toast.show({ variant: 'info', message: 'Sticky', duration: 0 })}>sticky</button>
    </>
  );
}

function setup() {
  render(
    <ToastProvider>
      <Buttons />
    </ToastProvider>,
  );
  return { click: async (element: HTMLElement) => void act(() => void fireEvent.click(element)) };
}

describe('ToastProvider / useToast (GEN-16)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows nothing until asked', () => {
    setup();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a success toast is a polite status and an error toast is an alert', async () => {
    const user = setup();
    await user.click(screen.getByText('ok'));
    expect(screen.getByRole('status')).toHaveTextContent('Booking saved');
    await user.click(screen.getByText('fail'));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save');
  });

  it('auto-dismisses a success toast after a few seconds', async () => {
    const user = setup();
    await user.click(screen.getByText('ok'));
    act(() => void vi.advanceTimersByTime(3000));
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(3000));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps an error on screen longer than a success', async () => {
    const user = setup();
    await user.click(screen.getByText('fail'));
    act(() => void vi.advanceTimersByTime(6000));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(3000));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('can be closed by hand', async () => {
    const user = setup();
    await user.click(screen.getByText('ok'));
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Booking saved')).toBeNull();
  });

  it('duration 0 never auto-dismisses', async () => {
    const user = setup();
    await user.click(screen.getByText('sticky'));
    act(() => void vi.advanceTimersByTime(60_000));
    expect(screen.getByText('Sticky')).toBeInTheDocument();
  });

  it('stacks several toasts and dismisses them independently', async () => {
    const user = setup();
    await user.click(screen.getByText('ok'));
    await user.click(screen.getByText('fail'));
    expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(2);
    await user.click(screen.getAllByRole('button', { name: 'Dismiss' })[0]);
    expect(screen.queryByText('Booking saved')).toBeNull();
    expect(screen.getByText('Could not save')).toBeInTheDocument();
  });

  it('useToast outside the provider is a clear error', () => {
    function Lonely() {
      useToast();
      return null;
    }
    expect(() => render(<Lonely />)).toThrow('useToast must be used inside <ToastProvider>');
  });
});
