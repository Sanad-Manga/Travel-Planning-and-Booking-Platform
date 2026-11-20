import type { Metadata } from 'next';
import { ComingSoon } from '@/components/ComingSoon';

export const metadata: Metadata = { title: 'Blog | Travel Planning and Booking Platform' };

export default function BlogPage() {
  return <ComingSoon title="Blog" />;
}
