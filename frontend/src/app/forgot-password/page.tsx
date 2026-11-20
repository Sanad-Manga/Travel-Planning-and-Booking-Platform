import type { Metadata } from 'next';
import { ComingSoon } from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Forgot password | Travel Planning and Booking Platform' };

export default function ForgotPasswordPage() {
  return <ComingSoon title="Forgot password" description="Reset your password by email." />;
}
