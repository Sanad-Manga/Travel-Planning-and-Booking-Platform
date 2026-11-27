'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiError } from '@/lib/api';
import type { Schema } from './types';
import { useApi } from './useApi';

export type BookingType = 'flight' | 'hotel';
export type BookingView = Schema<'FlightBookingResponseDto'> | Schema<'HotelBookingResponseDto'>;

/**
 * What the page should show. The backend has no "failed" booking status: a booking is waiting, confirmed,
 * expired (the hold ran out) or cancelled. A declined card is a payment problem, shown on the checkout page.
 */
export type BookingPhase = 'loading' | 'pending' | 'confirmed' | 'expired' | 'cancelled' | 'timeout' | 'error';

/** Ask every 2 s at first (the webhook usually lands within seconds), then every 5 s. */
export const FAST_POLL_MS = 2000;
export const SLOW_POLL_MS = 5000;
export const FAST_POLL_WINDOW_MS = 30_000;
/** After this long without a final answer, stop asking and tell the person to refresh. */
export const MAX_WAIT_MS = 90_000;

export function pollIntervalMs(elapsedMs: number): number {
  return elapsedMs < FAST_POLL_WINDOW_MS ? FAST_POLL_MS : SLOW_POLL_MS;
}

/** The booking statuses that will not change by waiting (a refund later does not change the booking page's state). */
export function isFinalStatus(status: BookingView['status'] | undefined): boolean {
  return status !== undefined && status !== 'PENDING_PAYMENT';
}

export function phaseOf(booking: BookingView | undefined, error: unknown, timedOut: boolean): BookingPhase {
  if (booking) {
    if (booking.status === 'CONFIRMED' || booking.status === 'COMPLETED') return 'confirmed';
    if (booking.status === 'EXPIRED') return 'expired';
    if (booking.status === 'CANCELLED') return 'cancelled';
    return timedOut ? 'timeout' : 'pending';
  }
  return error ? 'error' : 'loading';
}

export interface PolledBooking {
  phase: BookingPhase;
  booking: BookingView | undefined;
  /** Set only while there is no booking to show. A failed poll after the first answer keeps the last booking. */
  error: ApiError | undefined;
  /** Ask now, and start the waiting window again (the "Refresh" button after a timeout, or a failed first load). */
  refresh: () => void;
}

/**
 * FLT-23 / HTL-17: after payment the booking is confirmed by the Stripe webhook, not by the browser, so the page
 * asks the backend until the booking reaches a final status. It stops on CONFIRMED, COMPLETED, EXPIRED or CANCELLED,
 * stops after `MAX_WAIT_MS`, and does not poll a hidden tab (SWR default). A 4xx answer (not found, not yours) is not retried.
 */
export function usePollBooking(type: BookingType, id: string | null | undefined): PolledBooking {
  const key = id ? `/api/${type}-bookings/${encodeURIComponent(id)}` : null;
  const startedAt = useRef(0);
  const [round, setRound] = useState(0);
  /** The waiting window (booking + refresh round) that has run out; a new window starts as not timed out. */
  const [expiredWindow, setExpiredWindow] = useState<string | null>(null);
  const windowId = `${key}#${round}`;
  const timedOut = expiredWindow === windowId;

  const { data, error, mutate } = useApi<BookingView>(key, {
    refreshInterval: (latest) => {
      if (isFinalStatus(latest?.status)) return 0;
      const elapsed = startedAt.current === 0 ? 0 : Date.now() - startedAt.current;
      return elapsed >= MAX_WAIT_MS ? 0 : pollIntervalMs(elapsed);
    },
  });

  const final = isFinalStatus(data?.status);
  useEffect(() => {
    startedAt.current = Date.now();
    if (!key || final) return;
    const timer = setTimeout(() => setExpiredWindow(windowId), MAX_WAIT_MS);
    return () => clearTimeout(timer);
  }, [key, final, windowId]);

  const refresh = useCallback(() => {
    // Restart the clock before asking: the answer can arrive before the re-render, and SWR decides whether to
    // schedule the next poll from this clock when the answer arrives.
    startedAt.current = Date.now();
    setRound((current) => current + 1);
    void mutate();
  }, [mutate]);

  return { phase: phaseOf(data, error, timedOut), booking: data, error: data ? undefined : error, refresh };
}
