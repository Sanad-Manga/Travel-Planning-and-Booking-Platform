'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { Account, PasswordReset } from '@/api/admin';
import { formatInZone } from '@/lib/formatInZone';
import styles from './accounts.module.css';

type Props = {
  account: Pick<Account, 'name' | 'email'>;
  result: PasswordReset;
  onDismiss: () => void;
};

export function TemporaryPasswordDialog({ account, result, onDismiss }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const done = useRef<HTMLButtonElement>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const title = useId();
  const description = useId();

  useEffect(() => {
    const panel = dialog.current;
    panel?.showModal();
    done.current?.focus();
    return () => panel?.close();
  }, []);

  useEffect(() => {
    if (copyState !== 'copied') return;
    const timer = setTimeout(() => setCopyState('idle'), 1500);
    return () => clearTimeout(timer);
  }, [copyState]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(result.temporaryPassword);
      setCopyState('copied');
    } catch {
      setCopyState('manual');
    }
  }

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={title} aria-describedby={description}
      onCancel={(event) => { event.preventDefault(); onDismiss(); }}
      onClose={() => { if (dialog.current && !dialog.current.open) onDismiss(); }}>
      <h2 id={title}>Temporary password generated</h2>
      <dl className={styles.identity}>
        <dt>Account</dt><dd>{account.name}</dd>
        <dt>Email</dt><dd>{account.email}</dd>
      </dl>
      <label className="field">
        <span className="field-label">Temporary password</span>
        <input className={`field-input ${styles.password}`} readOnly value={result.temporaryPassword}
          autoComplete="off" spellCheck={false} onFocus={(event) => event.target.select()} />
      </label>
      <button type="button" className="btn" onClick={() => void copy()}>{copyState === 'copied' ? 'Copied' : 'Copy password'}</button>
      <span role="status">{copyState === 'copied' ? 'Password copied.' :
        copyState === 'manual' ? 'Select the password and copy it manually.' : ''}</span>
      <p>Expires: <time dateTime={result.expiresAt}>{formatInZone(result.expiresAt, 'UTC', { showZone: true })}</time></p>
      <p id={description} className="field-hint">This password is displayed only once. Share it securely with the account owner. They must change it after signing in.</p>
      <button ref={done} type="button" className="btn btn-primary" onClick={onDismiss}>Done</button>
    </dialog>
  );
}
