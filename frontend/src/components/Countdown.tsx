'use client';

import { useEffect, useRef, useState } from 'react';

export interface CountdownProps {
  /** UTC ISO timestamp the countdown runs to, e.g. a booking's `holdExpiresAt`. */
  expiresAt: string | null | undefined;
  /** Called once when the time reaches zero (also once on mount if it is already past). */
  onExpire?: () => void;
  /** Text shown before the time. */
  label?: string;
  /** Test hook: returns the current time in ms. */
  now?: () => number;
}

function format(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * GEN-11: counts down to a hold expiry. It is a timer for the eye; the server decides when a hold really ends,
 * so `onExpire` should re-fetch the booking rather than assume it expired. The time is read after mount, so
 * server and browser never disagree on the first paint. It is not announced every second (aria-live off).
 */
export function Countdown({ expiresAt, onExpire, label = 'Time left to pay:', now = Date.now }: CountdownProps) {
  const target = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;
  const [remaining, setRemaining] = useState<number | null>(null);
  const expireRef = useRef(onExpire);
  const firedRef = useRef(false);

  useEffect(() => {
    expireRef.current = onExpire;
  });

  useEffect(() => {
    firedRef.current = false;
    if (Number.isNaN(target)) return;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((target - now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0 && !firedRef.current) {
        firedRef.current = true;
        expireRef.current?.();
      }
      return seconds;
    };
    if (tick() === 0) return;
    const id = setInterval(() => {
      if (tick() === 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [target, now]);

  if (Number.isNaN(target)) return <span className="countdown">—</span>;
  const text = remaining === null ? '--:--' : remaining === 0 ? 'Expired' : format(remaining);
  return (
    <span className={`countdown${remaining === 0 ? ' countdown-expired' : ''}`} role="timer" aria-live="off">
      {remaining === 0 ? null : <span className="countdown-label">{label} </span>}
      <span className="countdown-time">{text}</span>
    </span>
  );
}
