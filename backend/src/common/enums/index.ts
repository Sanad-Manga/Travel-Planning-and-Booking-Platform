// Shared enums (docs/contracts.md section 5). Do not redefine these anywhere else.
// Values equal the member names so they read the same in the API and in MongoDB.

export enum Role {
  USER = 'USER',
  ADMIN = 'ADMIN',
  AIRLINE_MODERATOR = 'AIRLINE_MODERATOR',
  HOTEL_MODERATOR = 'HOTEL_MODERATOR',
}

export enum AccountStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DEACTIVATED = 'DEACTIVATED',
}

// Only transitions: PENDING_PAYMENT->CONFIRMED->COMPLETED,
// PENDING_PAYMENT->EXPIRED, CONFIRMED->CANCELLED.
// They go through BookingLifecycle.transition() (owned by Payments); nobody sets status directly.
export enum BookingStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  CONFIRMED = 'CONFIRMED',
  COMPLETED = 'COMPLETED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export enum BookingType {
  FLIGHT = 'FLIGHT',
  HOTEL = 'HOTEL',
}

export enum FlightStatus {
  SCHEDULED = 'SCHEDULED',
  CANCELLED = 'CANCELLED',
  DEPARTED = 'DEPARTED',
}

export enum CabinClass {
  ECONOMY = 'ECONOMY',
  PREMIUM_ECONOMY = 'PREMIUM_ECONOMY',
  BUSINESS = 'BUSINESS',
  FIRST = 'FIRST',
}

// ADULT 12+, CHILD 2-11, INFANT <2
export enum PassengerType {
  ADULT = 'ADULT',
  CHILD = 'CHILD',
  INFANT = 'INFANT',
}

export enum PaymentStatus {
  REQUIRES_PAYMENT = 'REQUIRES_PAYMENT',
  PROCESSING = 'PROCESSING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum RefundStatus {
  PENDING = 'PENDING',
  REFUNDED = 'REFUNDED',
  FAILED = 'FAILED',
}

export enum Visibility {
  PRIVATE = 'PRIVATE',
  PUBLIC = 'PUBLIC',
}

export enum PostStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
}

export enum ContentType {
  POST = 'POST',
  COMMENT = 'COMMENT',
  REVIEW = 'REVIEW',
  ITINERARY = 'ITINERARY',
}

export enum ReportStatus {
  OPEN = 'OPEN',
  DISMISSED = 'DISMISSED',
  HIDDEN = 'HIDDEN',
  DELETED = 'DELETED',
}

export enum NotificationType {
  BOOKING_CONFIRMED = 'BOOKING_CONFIRMED',
  BOOKING_CANCELLED = 'BOOKING_CANCELLED',
  REFUND_UPDATE = 'REFUND_UPDATE',
  FLIGHT_SCHEDULE_CHANGED = 'FLIGHT_SCHEDULE_CHANGED',
  ACCOUNT_SUSPENDED = 'ACCOUNT_SUSPENDED',
  PROVIDER_DEACTIVATED = 'PROVIDER_DEACTIVATED',
}
