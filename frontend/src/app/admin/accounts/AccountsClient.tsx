'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  adminAccountsPath, reactivateAccount, resetAccountPassword, suspendAccount,
  type Account, type AccountFilters, type PasswordReset,
} from '@/api/admin';
import { usePaginated } from '@/api/usePaginated';
import { useAuth } from '@/components/AuthProvider';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { Card } from '@/components/Card';
import { useConfirm } from '@/components/ConfirmProvider';
import { DataTable, type TableColumn } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { TextField } from '@/components/TextField';
import { useToast } from '@/components/ToastProvider';
import { toFriendlyError } from '@/lib/apiError';
import { formatInZone } from '@/lib/formatInZone';
import { TemporaryPasswordDialog } from './TemporaryPasswordDialog';
import styles from './accounts.module.css';

const roles = { ADMIN: 'Admin', USER: 'User', AIRLINE_MODERATOR: 'Airline moderator', HOTEL_MODERATOR: 'Hotel moderator' };
const statuses = { ACTIVE: 'Active', SUSPENDED: 'Suspended', DEACTIVATED: 'Deactivated' };
const tones = { ACTIVE: 'success', SUSPENDED: 'warning', DEACTIVATED: 'neutral' };
const labels = { suspend: 'Suspend account', reactivate: 'Reactivate account', reset: 'Reset password' };
type Action = keyof typeof labels;
type Disclosure = { account: Account; result: PasswordReset };

export function AccountsClient() {
  const { user } = useAuth();
  return user?.role === 'ADMIN' && !user.mustChangePassword ? <AccountList key={user.id} adminId={user.id} /> : null;
}

function AccountList({ adminId }: { adminId: string }) {
  const [input, setInput] = useState('');
  const [filters, setFilters] = useState<AccountFilters>({});
  const [busy, setBusy] = useState(false);
  const [disclosure, setDisclosure] = useState<Disclosure | null>(null);
  const list = usePaginated<Account>(adminAccountsPath, filters);
  const confirm = useConfirm();
  const toast = useToast();
  const filterPanel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const locked = useRef(false);
  const session = useRef<object | null>(null);
  const pendingSearch = input.trim() !== (filters.search ?? '');
  const filtered = Boolean(filters.role || filters.status || filters.search);
  const denied = list.error?.status === 401 || list.error?.status === 403;

  // Invalidate in-flight confirmations and responses when the authorized view ends.
  useLayoutEffect(() => {
    session.current = denied ? null : {};
    return () => { session.current = null; };
  }, [denied]);
  if (denied && disclosure) setDisclosure(null);

  useEffect(() => {
    if (!pendingSearch) return;
    const timer = setTimeout(() => setFilters((previous) => ({ ...previous, search: input.trim() || undefined })), 300);
    return () => clearTimeout(timer);
  }, [input, pendingSearch]);

  useEffect(() => {
    if (busy || disclosure || !opener.current) return;
    const target = opener.current;
    opener.current = null;
    (target.isConnected && !target.disabled ? target : filterPanel.current?.querySelector('input'))?.focus();
  }, [busy, disclosure]);

  function clearFilters() {
    setInput('');
    setFilters({});
    list.setPage(1);
  }

  const uncertain = pendingSearch || list.isValidating || list.isLoading || Boolean(list.error);
  async function act(action: Action, account: Account, button: HTMLButtonElement) {
    const owner = session.current;
    if (!owner || locked.current || uncertain || disclosure) return;
    locked.current = true;
    opener.current = button;
    setBusy(true);
    const messages = {
      suspend: `${account.name} will no longer be able to sign in until their account is reactivated.`,
      reactivate: `${account.name} will be able to sign in again.`,
      reset: `This will invalidate ${account.name}'s existing sessions and generate a temporary password. You will need to share it securely with them.`,
    };
    let result: PasswordReset | undefined;
    try {
      let submission: Promise<void> | undefined;
      const submit = async () => {
        if (session.current !== owner) return;
        if (action === 'reset') result = await resetAccountPassword(account.id);
        else if (action === 'suspend') await suspendAccount(account.id);
        else await reactivateAccount(account.id);
      };
      const accepted = await confirm({
        title: labels[action] + '?', message: messages[action], confirmLabel: labels[action],
        destructive: action !== 'reactivate', onConfirm: () => (submission ??= submit()),
      });
      if (!accepted || session.current !== owner) return;
      if (result) setDisclosure({ account, result });
      else toast.success(action === 'suspend' ? 'Account suspended successfully.' : 'Account reactivated successfully.');
      void list.revalidate();
    } catch (error) {
      if (session.current !== owner) return;
      const { status } = toFriendlyError(error);
      if (!status || status >= 500) {
        toast.error(action === 'reset'
          ? 'The password may have changed. Confirm a new reset if the account owner needs another temporary password.'
          : 'The account status may have changed. Check the refreshed account list before taking further action.');
      } else {
        // Only display the standard status text. Mutation payloads may be sensitive.
        toast.error(toFriendlyError({ status }).message);
      }
      void list.revalidate();
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  function actions(account: Account) {
    if (account.id === adminId || !['USER', 'HOTEL_MODERATOR', 'AIRLINE_MODERATOR'].includes(account.role)
      || !['ACTIVE', 'SUSPENDED'].includes(account.status)) return <span className="field-hint">No actions available</span>;
    const available: Action[] = account.status === 'ACTIVE' ? ['suspend', 'reset'] : ['reactivate'];
    return <div className={styles.actions}>{available.map((action) => (
      <button key={action} type="button" className={action === 'suspend' ? 'btn btn-danger' : 'btn'}
        disabled={busy || uncertain || !!disclosure} aria-label={`${labels[action]} for ${account.name}`}
        onClick={(event) => void act(action, account, event.currentTarget)}>
        {action === 'reset' ? labels.reset : action === 'suspend' ? 'Suspend' : 'Reactivate'}
      </button>
    ))}</div>;
  }

  const columns: TableColumn<Account>[] = [
    { id: 'name', header: 'Name', cell: (account) => <strong>{account.name}</strong> },
    { id: 'email', header: 'Email', cell: (account) => account.email },
    { id: 'role', header: 'Role', cell: (account) => roles[account.role] },
    { id: 'status', header: 'Status', cell: ({ status }) => <span className={`status-badge status-badge-${tones[status]}`}>{statuses[status]}</span> },
    { id: 'createdAt', header: 'Registration date', cell: ({ createdAt }) =>
      <time dateTime={createdAt}>{formatInZone(createdAt, 'UTC', { dateOnly: true })}</time> },
    { id: 'actions', header: 'Actions', cell: actions },
  ];

  return (
    <div className={styles.page}>
      <Breadcrumbs items={[{ label: 'Admin', href: '/admin' }, { label: 'Accounts' }]} />
      <PageHeader title="Account management" description="View, search and manage platform accounts." />
      <Card>
        <div ref={filterPanel} className={styles.filters} role="group" aria-label="Account filters">
          <TextField label="Search accounts" type="search" placeholder="Search by name or email"
            maxLength={100} value={input} onChange={(event) => setInput(event.target.value)} />
          <label className="field">
            <span className="field-label">Role</span>
            <select className="field-input" value={filters.role ?? ''} onChange={(event) =>
              setFilters({ ...filters, role: event.target.value as Account['role'] || undefined })}>
              <option value="">All roles</option>
              {Object.entries(roles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Status</span>
            <select className="field-input" value={filters.status ?? ''} onChange={(event) =>
              setFilters({ ...filters, status: event.target.value as Account['status'] || undefined })}>
              <option value="">All statuses</option>
              {Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <button type="button" className="btn" disabled={!filtered && !input} onClick={clearFilters}>Clear filters</button>
        </div>
      </Card>
      <Card>
        <div className={styles.results}>
          {list.isValidating && !list.isLoading && !list.error && <p className="field-hint" role="status">Updating accounts…</p>}
          <DataTable caption="Accounts" columns={columns} rows={list.items} rowKey={(account) => account.id}
            isLoading={list.isLoading || pendingSearch} error={list.error} onRetry={() => void list.revalidate()}
            emptyTitle={filtered ? 'No matching accounts' : 'No accounts found'} />
          {!pendingSearch && !list.error && list.data && list.data.total > 0 && <Pagination {...list.data} onPageChange={list.setPage} />}
        </div>
      </Card>
      {!denied && disclosure && <TemporaryPasswordDialog {...disclosure} onDismiss={() => setDisclosure(null)} />}
    </div>
  );
}
