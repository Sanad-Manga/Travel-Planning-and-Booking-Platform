import { config as loadEnv } from 'dotenv';

// Make sure backend/.env is loaded even if a module imports this file before ConfigModule runs.
// Does not override variables that are already set.
loadEnv({ quiet: true });

// Business constants (docs/contracts.md section 6).

/** How long flight seats / hotel rooms are held while a booking waits for payment. */
export const HOLD_MINUTES = Number(process.env.HOLD_MINUTES) > 0 ? Number(process.env.HOLD_MINUTES) : 10;

/** The single platform currency for prices, payments and refunds (PAY-04). */
export const PLATFORM_CURRENCY = process.env.PLATFORM_CURRENCY || 'USD';

// Auth
export const LOGIN_MAX_FAILED_ATTEMPTS = 5;
export const LOGIN_LOCK_MINUTES = 15;
export const SESSION_INACTIVITY_MINUTES = 30;
export const PASSWORD_MIN_LENGTH = 8;

/**
 * Cookie names, used by the Swagger cookie-auth scheme and by the auth guard.
 * Confirmed by the Auth owner (SCRUM-15); change them here only.
 */
export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

// Pagination
export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 50;

// Images (GEN-08)
export const IMAGE_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'] as const;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_ENTITY = 5; // per post / activity / hotel
export const MAX_LOGOS_PER_AIRLINE = 1;

// Itineraries
export const ITINERARY_MAX_DAYS = 60;
export const ITINERARY_TITLE_MAX_LENGTH = 100;

// Blog
export const COMMENT_MAX_LENGTH = 500;
export const POST_MAX_TAGS = 5;
export const TAG_MAX_LENGTH = 30;
export const REVIEW_MAX_LENGTH = 1000;

// Flights: infants pay this percentage of the cabin fare and take no seat.
// At least 1 adult per booking, infants <= adults.
export const INFANT_FARE_PERCENT = 10;
