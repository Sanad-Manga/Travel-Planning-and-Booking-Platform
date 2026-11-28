'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';
import { adminProvidersPath, deactivateProvider, reactivateProvider, type Provider, type ProviderType } from '@/api/admin';
import { usePaginated } from '@/api/usePaginated';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { Card } from '@/components/Card';
import { useConfirm } from '@/components/ConfirmProvider';
import { DataTable, type TableColumn } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { useToast } from '@/components/ToastProvider';
import { toFriendlyError } from '@/lib/apiError';
import { CreateProviderForm } from './CreateProviderForm';
import styles from './providers.module.css';

export function ProvidersClient() {
  const [type, setType] = useState<ProviderType>('airline');
  const [formType, setFormType] = useState<ProviderType | null>(null);
  const [confirming, setConfirming] = useState(false);
  const statusLock = useRef(false);
  const mounted = useRef(false);
  const createButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const list = usePaginated<Provider>(adminProvidersPath, { type });
  const { mutate } = useSWRConfig();
  const confirm = useConfirm();
  const toast = useToast();
  const label = type === 'airline' ? 'Airline' : 'Hotel';

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useLayoutEffect(() => {
    if (formType === null && restoreFocus.current) {
      restoreFocus.current = false;
      createButton.current?.focus();
    }
  }, [formType]);

  async function refresh(kind: ProviderType) {
    // Invalidate every cached page for this type, including pages that are not currently mounted.
    await mutate((key) => typeof key === 'string' && key.startsWith(adminProvidersPath + '?')
      && new URLSearchParams(key.slice(adminProvidersPath.length + 1)).get('type') === kind,
      undefined, { revalidate: true, throwOnError: false });
  }

  function closeForm() {
    restoreFocus.current = true;
    setFormType(null);
  }

  async function reconcile(kind: ProviderType) {
    if (mounted.current) setType(kind);
    await refresh(kind);
  }

  async function updateStatus(provider: Provider) {
    if (statusLock.current || formType) return;
    statusLock.current = true;
    setConfirming(true);
    const deactivating = provider.isActive;
    const action = deactivating ? 'Deactivate' : 'Reactivate';
    let request: Promise<void> | undefined;

    async function applyChange() {
      if (!mounted.current) return;
      try {
        const update = deactivating ? deactivateProvider : reactivateProvider;
        await update(type, provider.id);
        await refresh(type);
        if (mounted.current) toast.success(deactivating ? 'Provider deactivated.' : 'Provider reactivated.');
      } catch (error) {
        const { status, message } = toFriendlyError(error);
        const uncertain = !status || status >= 500;
        if (uncertain || status === 404 || status === 409) await refresh(type);
        if (mounted.current) toast.error(uncertain
          ? 'The provider status may have changed. Check the refreshed list before trying again.'
          : message);
      }
    }

    try {
      await confirm({
        title: `${action} ${provider.name}?`,
        message: deactivating
          ? 'This provider will be hidden from search and cannot receive new bookings. Existing confirmed bookings will not be affected.'
          : 'This provider will become available for new bookings again, subject to the platform’s normal availability rules.',
        confirmLabel: `${action} provider`,
        destructive: deactivating,
        onConfirm: () => (request ??= applyChange()),
      });
    } finally {
      statusLock.current = false;
      if (mounted.current) setConfirming(false);
    }
  }

  const columns: TableColumn<Provider>[] = [
    { id: 'name', header: 'Name', cell: (provider) => provider.name },
    { id: 'type', header: 'Type', cell: () => label },
    { id: 'state', header: 'Status', cell: ({ isActive }) => (
      <span className={`status-badge status-badge-${isActive ? 'success' : 'neutral'}`}>{isActive ? 'Active' : 'Inactive'}</span>
    ) },
    { id: 'actions', header: 'Actions', cell: (provider) => {
      const action = provider.isActive ? 'Deactivate' : 'Reactivate';
      return <button type="button" className={provider.isActive ? 'btn btn-danger' : 'btn'}
        aria-label={`${action} ${provider.name}`} disabled={confirming || formType !== null || list.isValidating}
        onClick={() => void updateStatus(provider)}>{action}</button>;
    } },
  ];

  return (
    <div className={styles.page}>
      <Breadcrumbs items={[{ label: 'Admin', href: '/admin' }, { label: 'Providers' }]} />
      <PageHeader title="Providers" description="Create airline and hotel profiles and manage their availability."
        action={formType === null ? (
          <button ref={createButton} type="button" className="btn btn-primary" disabled={confirming}
            onClick={() => { if (!statusLock.current) setFormType(type); }}>Create provider</button>
        ) : undefined} />
      {formType !== null && (
        <CreateProviderForm key={formType} type={formType} onTypeChange={setFormType} onCancel={closeForm}
          onUncertain={reconcile}
          onCreated={async (kind) => {
            await reconcile(kind);
            if (!mounted.current) return;
            closeForm();
            toast.success(kind === 'airline' ? 'Airline created.' : 'Hotel created.');
          }} />
      )}
      <Card>
        <label className={`field ${styles.selector}`}>
          <span className="field-label">Provider type</span>
          <select className="field-input" value={type} disabled={confirming || formType !== null}
            onChange={(event) => setType(event.target.value === 'hotel' ? 'hotel' : 'airline')}>
            <option value="airline">Airlines</option>
            <option value="hotel">Hotels</option>
          </select>
        </label>
        <DataTable caption={type === 'airline' ? 'Airlines' : 'Hotels'} columns={columns}
          rows={list.items} rowKey={(provider) => provider.id} isLoading={list.isLoading}
          error={list.error} onRetry={() => void list.revalidate()}
          emptyTitle={type === 'airline' ? 'No airlines found' : 'No hotels found'} />
        {list.data && !list.error && list.data.total > 0 && (
          <Pagination {...list.data} onPageChange={list.setPage} />
        )}
      </Card>
    </div>
  );
}
