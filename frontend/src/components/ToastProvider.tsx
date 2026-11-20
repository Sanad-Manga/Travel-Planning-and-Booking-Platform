'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, type AlertVariant } from './Alert';

export interface ToastOptions {
  variant?: AlertVariant;
  message: string;
  /** Milliseconds before it closes itself; 0 keeps it until closed by hand. */
  duration?: number;
}

interface Toasts {
  show: (options: ToastOptions) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

interface ToastItem {
  id: number;
  variant: AlertVariant;
  message: string;
}

const SUCCESS_MS = 5000;
const ERROR_MS = 8000; // errors stay longer: they need reading and often a decision

const ToastContext = createContext<Toasts | null>(null);

/**
 * Mount once near the root (see app/layout). Short notices for the result of an action:
 *
 *   const toast = useToast();
 *   toast.success('Booking cancelled');
 *   toast.error(toError(err).message);
 *
 * Each toast closes itself, or can be closed with its button. For something the user must act on
 * (a failed form, a retry) use an inline <Alert> instead.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const show = useCallback(
    ({ variant = 'info', message, duration }: ToastOptions) => {
      const id = nextId.current++;
      setItems((current) => [...current, { id, variant, message }]);
      const ms = duration ?? (variant === 'error' ? ERROR_MS : SUCCESS_MS);
      if (ms > 0) timers.current.set(id, setTimeout(() => dismiss(id), ms));
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  const api = useMemo<Toasts>(
    () => ({
      show,
      success: (message) => show({ variant: 'success', message }),
      error: (message) => show({ variant: 'error', message }),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region">
        {items.map((item) => (
          <Alert key={item.id} variant={item.variant} onClose={() => dismiss(item.id)}>
            {item.message}
          </Alert>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): Toasts {
  const toasts = useContext(ToastContext);
  if (!toasts) throw new Error('useToast must be used inside <ToastProvider>');
  return toasts;
}
