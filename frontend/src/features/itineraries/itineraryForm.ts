import { z } from 'zod';

export const TITLE_MAX_LENGTH = 100;

/** A real calendar date written `YYYY-MM-DD` ("2026-02-30" is not one), as the backend requires. */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** ITN-01: the same rules as the backend's CreateItineraryDto, checked before anything is sent. */
export const itineraryFormSchema = z.object({
  title: z.string().trim().min(1, 'Enter a title.').max(TITLE_MAX_LENGTH, `Use at most ${TITLE_MAX_LENGTH} characters.`),
  countryCodes: z.array(z.string()).min(1, 'Choose at least one country.'),
  startDate: z.string().refine(isCalendarDate, 'Choose a start date.'),
});

export type ItineraryFormValues = z.infer<typeof itineraryFormSchema>;

export const EMPTY_ITINERARY: ItineraryFormValues = { title: '', countryCodes: [], startDate: '' };
