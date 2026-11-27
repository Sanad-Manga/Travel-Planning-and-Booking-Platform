'use client';

import { useState } from 'react';
import { Alert } from '@/components/Alert';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { Card } from '@/components/Card';
import { useConfirm } from '@/components/ConfirmProvider';
import { DataTable, type TableColumn } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { FormActions } from '@/components/FormActions';
import { ImageUploader, type ImageReference } from '@/components/ImageUploader';
import { Pagination } from '@/components/Pagination';
import { Skeleton } from '@/components/Skeleton';
import { Spinner } from '@/components/Spinner';
import { StatusBadge } from '@/components/StatusBadge';
import { Steps } from '@/components/Steps';
import { TextField } from '@/components/TextField';
import { useToast } from '@/components/ToastProvider';

/** Every colour token, in the order the guide shows them. Names match globals.css. */
const COLOUR_TOKENS = [
  'background',
  'surface',
  'surface-2',
  'border',
  'border-strong',
  'foreground',
  'muted',
  'primary',
  'primary-hover',
  'primary-soft',
  'success-bg',
  'success-text',
  'warning-bg',
  'warning-text',
  'danger-bg',
  'danger-text',
];

const TYPE_SCALE = [
  ['2xl', 'var(--font-size-2xl)'],
  ['xl', 'var(--font-size-xl)'],
  ['lg', 'var(--font-size-lg)'],
  ['base', 'var(--font-size-base)'],
  ['sm', 'var(--font-size-sm)'],
  ['xs', 'var(--font-size-xs)'],
] as const;

const BOOKINGS = [
  { id: 'TRV-20418', route: 'CAI to LIS', date: '18 Dec 2026', status: 'CONFIRMED', total: '$412.00' },
  { id: 'TRV-20397', route: 'CAI to IST', date: '02 Jan 2027', status: 'PENDING_PAYMENT', total: '$238.50' },
  { id: 'TRV-20356', route: 'LIS to OPO', date: '21 Dec 2026', status: 'CANCELLED', total: '$64.00' },
  { id: 'TRV-20311', route: 'CAI to DXB', date: '14 Feb 2027', status: 'FAILED', total: '$355.20' },
];

type Booking = (typeof BOOKINGS)[number];

const BOOKING_COLUMNS: readonly TableColumn<Booking>[] = [
  { id: 'id', header: 'Booking', cell: (row) => row.id },
  { id: 'route', header: 'Route', cell: (row) => row.route },
  { id: 'date', header: 'Date', cell: (row) => row.date },
  { id: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
  { id: 'total', header: 'Total', cell: (row) => row.total },
];

export function ThemeShowcase({ name }: { name: string }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [page, setPage] = useState(1);
  const [images, setImages] = useState<readonly ImageReference[]>([]);

  async function fakeUpload(file: File): Promise<ImageReference> {
    return { id: `${file.name}-${Date.now()}`, url: URL.createObjectURL(file) };
  }

  return (
    <div>
      <h2>{name} theme</h2>

      <div className="styleguide-section">
        <p className="styleguide-label">Palette tokens</p>
        <ul className="styleguide-swatches">
          {COLOUR_TOKENS.map((token) => (
            <li key={token} className="styleguide-swatch">
              {/* Guide-only: product screens never use inline styles. */}
              <div className="styleguide-chip" style={{ background: `var(--${token})` }} />
              <code>--{token}</code>
            </li>
          ))}
        </ul>
      </div>

      <div className="styleguide-section styleguide-type">
        <p className="styleguide-label">Type scale</p>
        {TYPE_SCALE.map(([label, size]) => (
          <p key={label} style={{ fontSize: size }}>
            {label}: Plan the trip, book the flight
          </p>
        ))}
        <p>
          Body text with a <a href="#theme-link">link inside it</a>. <span className="field-hint">Muted helper text.</span>
        </p>
      </div>

      <div className="styleguide-section">
        <p className="styleguide-label">Buttons (one primary per view) and badges</p>
        <div className="styleguide-row">
          <button type="button" className="btn btn-primary">Book now</button>
          <button type="button" className="btn">Save for later</button>
          <button type="button" className="btn btn-danger">Cancel booking</button>
          <button type="button" className="btn btn-primary" disabled>Disabled</button>
          <button type="button" className="btn btn-sm">Small</button>
        </div>
        <div className="styleguide-row">
          <StatusBadge status="CONFIRMED" />
          <StatusBadge status="PENDING_PAYMENT" />
          <StatusBadge status="FAILED" />
          <StatusBadge status="SCHEDULED" />
          <StatusBadge status="CANCELLED" />
        </div>
      </div>

      <div className="styleguide-section">
        <p className="styleguide-label">Form fields: default, hint, error, disabled</p>
        <TextField label="Destination" placeholder="City or airport" hint="Where do you want to go?" />
        <TextField label="Email" defaultValue="ahmed@" error="Enter a complete email address." required />
        <TextField label="Booking reference" defaultValue="TRV-20418" disabled />
        <FormActions
          primaryLabel="Search flights"
          primaryType="button"
          onPrimary={() => {
            setSubmitting(true);
            window.setTimeout(() => setSubmitting(false), 1500);
          }}
          submitting={submitting}
          submittingLabel="Searching…"
          cancelLabel="Reset"
          onCancel={() => setSubmitting(false)}
        />
      </div>

      <div className="styleguide-section">
        <p className="styleguide-label">Alerts and toasts</p>
        <Alert variant="error" title="Could not load flights" hint="Check your connection and try again." onRetry={() => undefined}>
          The search service did not respond.
        </Alert>
        <Alert variant="success" title="Booking confirmed">Your confirmation was sent by email.</Alert>
        <Alert variant="warning" title="Fare expires soon">This price is held for 15 minutes.</Alert>
        <Alert variant="info">Prices may change at checkout.</Alert>
        <div className="styleguide-row">
          <button type="button" className="btn btn-sm" onClick={() => toast.success('Booking saved')}>Show success toast</button>
          <button type="button" className="btn btn-sm" onClick={() => toast.error('Could not save the booking')}>Show error toast</button>
        </div>
      </div>

      <div className="styleguide-section">
        <p className="styleguide-label">Breadcrumbs, steps, card</p>
        <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Flights', href: '/flights' }, { label: 'Cairo to Lisbon' }]} />
        <Steps steps={['Choose flight', 'Passenger details', 'Pay']} current={2} />
        <Card title="Three days in Porto">
          <p>Riverside walks, port cellars and a slow train up the Douro valley.</p>
        </Card>
      </div>

      <div className="styleguide-section">
        <p className="styleguide-label">Table with pagination</p>
        <DataTable
          caption="Bookings"
          columns={BOOKING_COLUMNS}
          rows={BOOKINGS}
          rowKey={(row) => row.id}
        />
        <Pagination page={page} totalPages={3} total={38} limit={4} onPageChange={setPage} />
      </div>

      <div className="styleguide-section">
        <p className="styleguide-label">Empty state</p>
        <EmptyState icon="✈" title="No trips yet" description="When you book a flight or hotel it will show up here." action={{ label: 'Search flights', href: '/flights' }} />
        <p className="styleguide-label">Spinner and skeleton</p>
        <div className="styleguide-row">
          <Spinner label="Loading flights" />
          <Spinner size="sm" label="Saving" />
        </div>
        <Skeleton lines={3} />
      </div>

      <div className="styleguide-section">
        <p className="styleguide-label">Confirm dialog</p>
        <div className="styleguide-row">
          <button
            type="button"
            className="btn"
            onClick={() => void confirm({ title: 'Save these changes?', message: 'Your itinerary will be updated.', confirmLabel: 'Save changes' })}
          >
            Open confirm
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() =>
              void confirm({
                title: 'Cancel this booking?',
                message: 'TRV-20418 will be cancelled. This cannot be undone.',
                confirmLabel: 'Cancel booking',
                destructive: true,
              })
            }
          >
            Open destructive confirm
          </button>
        </div>
      </div>

      <div className="styleguide-section">
        <p className="styleguide-label">Image uploader (files stay in the browser here)</p>
        <ImageUploader
          images={images}
          onChange={(update) => setImages(update)}
          upload={fakeUpload}
          remove={async () => undefined}
          maxImages={3}
          label={`${name} photos`}
        />
      </div>
    </div>
  );
}
