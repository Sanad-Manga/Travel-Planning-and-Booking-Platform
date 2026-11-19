'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog';

export type ConfirmOptions = Pick<
  ConfirmDialogProps,
  'title' | 'message' | 'confirmLabel' | 'cancelLabel' | 'destructive'
> & {
  /**
   * Optional work to run when the user confirms. The dialog stays open and disabled while it runs and
   * closes when it finishes. If it throws, the dialog closes and `confirm` rejects with that error, so
   * the caller can show it. Without it, `confirm` just resolves true.
   */
  onConfirm?: () => Promise<void> | void;
};

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

interface Pending {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
  reject: (error: unknown) => void;
}

/**
 * Mount once near the root (see app/layout). Anything below it asks before a destructive action:
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ title: 'Delete this post?', message: 'This cannot be undone.', confirmLabel: 'Delete post', destructive: true })) {
 *     await deletePost(id);
 *   }
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef<Pending | null>(null);

  const confirm = useCallback<Confirm>((options) => {
    return new Promise<boolean>((resolve, reject) => {
      // A second request while one is open cancels the first, so promises are never left hanging.
      active.current?.resolve(false);
      const next = { options, resolve, reject };
      active.current = next;
      setBusy(false);
      setPending(next);
    });
  }, []);

  function close(current: Pending) {
    if (active.current === current) active.current = null;
    setPending((now) => (now === current ? null : now));
    setBusy(false);
  }

  async function accept(current: Pending) {
    if (!current.options.onConfirm) {
      current.resolve(true);
      close(current);
      return;
    }
    setBusy(true);
    try {
      await current.options.onConfirm();
      current.resolve(true);
    } catch (error) {
      current.reject(error);
    } finally {
      close(current);
    }
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending ? (
        <ConfirmDialog
          title={pending.options.title}
          message={pending.options.message}
          confirmLabel={pending.options.confirmLabel}
          cancelLabel={pending.options.cancelLabel}
          destructive={pending.options.destructive}
          busy={busy}
          onConfirm={() => void accept(pending)}
          onCancel={() => {
            pending.resolve(false);
            close(pending);
          }}
        />
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return confirm;
}
