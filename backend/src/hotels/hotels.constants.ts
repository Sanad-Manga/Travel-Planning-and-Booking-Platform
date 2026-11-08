// HTL-01 profile limits. Module-local on purpose: docs/contracts.md section 6 only fixes the photo count (MAX_IMAGES_PER_ENTITY in common).
export const HOTEL_NAME_MAX_LENGTH = 100;
export const HOTEL_ADDRESS_MAX_LENGTH = 200;
export const HOTEL_DESCRIPTION_MAX_LENGTH = 2000;
export const HOTEL_MIN_STARS = 1;
export const HOTEL_MAX_STARS = 5;
export const HOTEL_MAX_AMENITIES = 30;
export const HOTEL_AMENITY_MAX_LENGTH = 50;

// HTL-03 room limits (module-local: the contract only fixes "occupancy >= 1" and "price > 0").
export const ROOM_NAME_MAX_LENGTH = 50;
export const ROOM_TYPE_MAX_LENGTH = 50;
export const ROOM_MAX_BEDS = 20;
export const ROOM_MAX_OCCUPANCY = 50;
// Upper bound only to keep the value a safe integer / sane (100 000.00 per night).
export const ROOM_MAX_PRICE_CENTS = 10_000_000;

// HTL-10 cancellation tiers. A threshold is a whole number of days; a year ahead is more than any booking allows.
export const HOTEL_MAX_CANCELLATION_TIERS = 20;
export const HOTEL_MAX_TIER_DAYS = 365;
