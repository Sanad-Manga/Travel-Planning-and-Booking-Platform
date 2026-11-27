import type { Metadata } from 'next';
import { RequireRole } from '@/components/RequireRole';
import { CreateModeratorClient } from './CreateModeratorClient';

export const metadata: Metadata = { title: 'Create moderator | Admin | Travel Planning and Booking Platform' };

export default function CreateModeratorPage() {
  return (
    <RequireRole roles={['ADMIN']}>
      <CreateModeratorClient />
    </RequireRole>
  );
}
