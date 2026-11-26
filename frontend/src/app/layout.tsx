import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/components/AuthProvider';
import { AppShell } from '@/components/AppShell';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import { ToastProvider } from '@/components/ToastProvider';
import { SWRProvider } from '@/api/SWRProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Travel Planning and Booking Platform',
  description: 'Plan trips, book flights and hotels, and share itineraries.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ConfirmProvider>
          <ToastProvider>
            <AuthProvider>
              <SWRProvider>
                <AppShell>{children}</AppShell>
              </SWRProvider>
            </AuthProvider>
          </ToastProvider>
        </ConfirmProvider>
      </body>
    </html>
  );
}
