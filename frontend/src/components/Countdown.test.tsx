import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Countdown } from './Countdown';

const T0 = Date.parse('2026-11-20T12:00:00.000Z');
let clock = T0;
const now = () => clock;
const expiresIn = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();
const advance = (ms: number) =>
  act(() => {
    clock += ms;
    vi.advanceTimersByTime(ms);
  });

describe('Countdown (GEN-11)', () => {
  beforeEach(() => {
    clock = T0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the time left as mm:ss and counts down every second', () => {
    render(<Countdown expiresAt={expiresIn(125)} now={now} />);
    expect(screen.getByRole('timer')).toHaveTextContent('Time left to pay: 02:05');
    advance(1000);
    expect(screen.getByRole('timer')).toHaveTextContent('02:04');
    advance(4000);
    expect(screen.getByRole('timer')).toHaveTextContent('02:00');
  });

  it('shows hours only when there is at least one', () => {
    render(<Countdown expiresAt={expiresIn(3661)} now={now} />);
    expect(screen.getByRole('timer')).toHaveTextContent('1:01:01');
  });

  it('rounds a partial second up, so it never shows 00:00 before it has expired', () => {
    render(<Countdown expiresAt={new Date(T0 + 500).toISOString()} now={now} />);
    expect(screen.getByRole('timer')).toHaveTextContent('00:01');
  });

  it('calls onExpire once when it reaches zero and shows Expired', () => {
    const onExpire = vi.fn();
    render(<Countdown expiresAt={expiresIn(3)} onExpire={onExpire} now={now} />);
    advance(2000);
    expect(onExpire).not.toHaveBeenCalled();
    advance(1000);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('timer')).toHaveTextContent('Expired');
    advance(5000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('calls onExpire on mount when the time has already passed', () => {
    const onExpire = vi.fn();
    render(<Countdown expiresAt={expiresIn(-30)} onExpire={onExpire} now={now} />);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('timer')).toHaveTextContent('Expired');
  });

  it('restarts for a new expiry time and can fire again', () => {
    const onExpire = vi.fn();
    const { rerender } = render(<Countdown expiresAt={expiresIn(1)} onExpire={onExpire} now={now} />);
    advance(1000);
    expect(onExpire).toHaveBeenCalledTimes(1);
    rerender(<Countdown expiresAt={expiresIn(61)} onExpire={onExpire} now={now} />);
    expect(screen.getByRole('timer')).toHaveTextContent('01:00');
    advance(60_000);
    expect(onExpire).toHaveBeenCalledTimes(2);
  });

  it('uses the latest onExpire without restarting the timer', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Countdown expiresAt={expiresIn(2)} onExpire={first} now={now} />);
    rerender(<Countdown expiresAt={expiresIn(2)} onExpire={second} now={now} />);
    advance(2000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('shows a dash and never fires for a missing or invalid time', () => {
    const onExpire = vi.fn();
    const { container, rerender } = render(<Countdown expiresAt={null} onExpire={onExpire} now={now} />);
    expect(container).toHaveTextContent('—');
    rerender(<Countdown expiresAt="garbage" onExpire={onExpire} now={now} />);
    expect(container).toHaveTextContent('—');
    advance(5000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('is not announced every second', () => {
    render(<Countdown expiresAt={expiresIn(60)} now={now} />);
    expect(screen.getByRole('timer')).toHaveAttribute('aria-live', 'off');
  });

  it('stops its interval when unmounted', () => {
    const { unmount } = render(<Countdown expiresAt={expiresIn(60)} now={now} />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
