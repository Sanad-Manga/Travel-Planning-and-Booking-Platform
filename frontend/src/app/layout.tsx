import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Travel Planning and Booking Platform',
  description: 'Plan trips, book flights and hotels, and share itineraries.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ConfirmProvider>{children}</ConfirmProvider>
      </body>
    </html>
  );
}
