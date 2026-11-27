'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { CreatedModerator, CreateModeratorBody } from '@/api/admin';
import { moderatorRoles } from './moderatorFormSchema';
import styles from './moderators.module.css';

interface Props {
  account: Pick<CreatedModerator, 'name' | 'email'>;
  role: CreateModeratorBody['role'];
  providerName: string;
  temporaryPassword: string;
  onDismiss: () => void;
}

export function ModeratorCreatedDialog({ account, role, providerName, temporaryPassword, onDismiss }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const done = useRef<HTMLButtonElement>(null);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'manual'>('idle');
  const title = useId();
  const help = useId();

  useEffect(() => {
    const panel = dialog.current;
    panel?.showModal();
    done.current?.focus();
    return () => panel?.close();
  }, []);

  useEffect(() => {
    if (copy !== 'copied') return;
    const timer = setTimeout(() => setCopy('idle'), 1500);
    return () => clearTimeout(timer);
  }, [copy]);

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setCopy('copied');
    } catch {
      setCopy('manual');
    }
  }

  return (
    <dialog className={styles.dialog} ref={dialog} aria-labelledby={title} aria-describedby={help}
      onCancel={(event) => { event.preventDefault(); onDismiss(); }}
      onClose={() => { if (dialog.current && !dialog.current.open) onDismiss(); }}>
      <h2 id={title}>Moderator created successfully</h2>
      <dl className={styles.identity}>
        <dt>Name</dt><dd>{account.name}</dd>
        <dt>Email</dt><dd>{account.email}</dd>
        <dt>Role</dt><dd>{moderatorRoles[role].label}</dd>
        <dt>Provider</dt><dd>{providerName}</dd>
      </dl>
      <label className="field">
        <span className="field-label">Temporary password</span>
        <textarea className={`field-input ${styles.secret}`} readOnly rows={2} spellCheck={false}
          value={temporaryPassword} onFocus={(event) => event.currentTarget.select()} />
      </label>
      <button type="button" className="btn" onClick={() => void copyPassword()}>
        {copy === 'copied' ? 'Copied' : 'Copy password'}
      </button>
      <span role="status" className="field-hint">
        {copy === 'copied' ? 'Password copied.' : copy === 'manual' ? 'Select the password and copy it manually.' : ''}
      </span>
      <div id={help}>
        <p>This password is valid for one login within 24 hours. The moderator must change it after signing in.</p>
        <p>Share it securely. You cannot reopen this password disclosure after closing.</p>
      </div>
      <button ref={done} type="button" className="btn btn-primary" onClick={onDismiss}>Done</button>
    </dialog>
  );
}
