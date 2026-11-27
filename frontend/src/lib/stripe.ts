import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { usablePublishableKey } from './checkout';

let cached: Promise<Stripe | null> | null = null;

/**
 * PAY-01: Stripe.js, loaded once and only when a checkout page needs it. Card details are typed into Stripe's own
 * iframe and go straight to Stripe, never to this app or the backend. Returns null when no usable publishable key is
 * set (the page then explains it instead of failing). Only the publishable key (pk_...) is ever read here.
 */
export function getStripe(): Promise<Stripe | null> | null {
  const key = usablePublishableKey(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
  if (!key) return null;
  cached ??= loadStripe(key);
  return cached;
}
