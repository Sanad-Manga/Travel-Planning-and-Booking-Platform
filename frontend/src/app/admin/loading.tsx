import { Skeleton } from '@/components/Skeleton';

export default function LoadingAdminDashboard() {
  return <div role="status" aria-label="Loading the admin dashboard"><Skeleton lines={3} /></div>;
}
