import type { EmptyStateProps } from './EmptyState';

/**
 * GEN-04: the wording of every list that can be empty, in one place so the tone stays the same across the app.
 * Use it as `<EmptyState {...emptyMessages.flightBookings} />`. A page that wants a different next step
 * spreads it and overrides `action`.
 */
export const emptyMessages = {
  flightBookings: {
    icon: '✈️',
    title: 'No flight bookings yet',
    description: 'When you book a flight it will show up here.',
    action: { label: 'Search flights', href: '/flights' },
  },
  hotelBookings: {
    icon: '🏨',
    title: 'No hotel reservations yet',
    description: 'When you book a stay it will show up here.',
    action: { label: 'Search hotels', href: '/hotels' },
  },
  flightSearch: {
    icon: '🔎',
    title: 'No flights found',
    description: 'Try other dates or airports, or search again with fewer passengers.',
  },
  hotelSearch: {
    icon: '🔎',
    title: 'No hotels found',
    description: 'Try other dates or another city.',
  },
  posts: {
    icon: '📝',
    title: 'No posts yet',
    description: 'Be the first to share a trip.',
    action: { label: 'Write a post', href: '/posts/new' },
  },
  postSearch: {
    icon: '🔎',
    title: 'No posts match your search',
    description: 'Check the spelling or try a different word or tag.',
  },
  comments: {
    title: 'No comments yet',
    description: 'Start the conversation.',
  },
  favourites: {
    icon: '❤️',
    title: 'No favourites yet',
    description: 'Save hotels and flights you like to find them again here.',
  },
  itineraries: {
    icon: '🗺️',
    title: 'No itineraries yet',
    description: 'Plan your first trip, day by day.',
    action: { label: 'Create an itinerary', href: '/itineraries/new' },
  },
  notifications: {
    icon: '🔔',
    title: 'You are all caught up',
    description: 'New notifications will appear here.',
  },
  reviews: {
    title: 'No reviews yet',
    description: 'Reviews appear here after guests have stayed.',
  },
} satisfies Record<string, EmptyStateProps>;

export type EmptyMessageKey = keyof typeof emptyMessages;
