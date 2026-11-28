import type { Metadata } from 'next';
import { RequireRole } from '@/components/RequireRole';
import { ProvidersClient } from './ProvidersClient';

export const metadata: Metadata = { title: 'Providers | Admin | Travel Planning and Booking Platform' };

export default function ProvidersPage() {
  return <RequireRole roles={['ADMIN']}><ProvidersClient /></RequireRole>;
}
