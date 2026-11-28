import type { ReactNode } from 'react';
import { RequireRole } from '@/components/RequireRole';
import { AdminNavigation } from './AdminNavigation';
import styles from './admin.module.css';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RequireRole roles={['ADMIN']}>
      <div className={styles.shell}>
        <AdminNavigation />
        {children}
      </div>
    </RequireRole>
  );
}
