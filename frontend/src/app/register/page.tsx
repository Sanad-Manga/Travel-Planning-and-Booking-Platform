import type { Metadata } from 'next';
import { RegisterForm } from '@/features/account/RegisterForm';

export const metadata: Metadata = { title: 'Register | Travel Planning and Booking Platform' };

export default function RegisterPage() {
  return <RegisterForm />;
}
