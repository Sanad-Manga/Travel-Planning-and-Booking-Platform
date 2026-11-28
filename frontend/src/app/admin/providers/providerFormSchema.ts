import { z } from 'zod';
import type { CreateAirlineBody } from '@/api/airlines';
import type { CreateHotelBody } from '@/api/hotels';

const airlineDetails = z.object({
  name: z.string().trim().min(2, 'Enter at least 2 characters.').max(100, 'Use at most 100 characters.'),
  code: z.string().trim().regex(/^[A-Za-z0-9]{2,3}$/, 'Use 2 or 3 ASCII letters or digits.').toUpperCase(),
});

const amenities = z.string().transform((value) => {
  const seen = new Set<string>();
  return value.split(/[,\n]/).map((entry) => entry.trim()).filter((entry) => {
    const key = entry.toLowerCase();
    if (!entry || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}).pipe(z.array(z.string().max(50, 'Each amenity must be at most 50 characters.'))
  .max(30, 'Use at most 30 distinct amenities.'));

const hotelDetails = z.object({
  name: z.string().trim().min(1, 'Enter a hotel name.').max(100, 'Use at most 100 characters.'),
  address: z.string().trim().min(1, 'Enter an address.').max(200, 'Use at most 200 characters.'),
  countryCode: z.string().min(1, 'Select a country.'),
  cityId: z.string().min(1, 'Select a city.').max(50, 'Choose a valid city.'),
  description: z.string().trim().min(1, 'Enter a description.').max(2000, 'Use at most 2,000 characters.'),
  starRating: z.string().regex(/^[1-5]$/, 'Select a star rating from 1 to 5.').transform(Number),
  amenities,
});

type Draft = { type: 'airline'; body: CreateAirlineBody } | { type: 'hotel'; body: CreateHotelBody };

export const providerFormSchema = z.object({
  type: z.enum(['airline', 'hotel']),
  name: z.string(),
  code: z.string(),
  address: z.string(),
  countryCode: z.string(),
  cityId: z.string(),
  description: z.string(),
  starRating: z.string(),
  amenities: z.string(),
}).transform((value, context): Draft => {
  if (value.type === 'airline') {
    const result = airlineDetails.safeParse(value);
    if (result.success) return { type: 'airline', body: result.data };
    for (const issue of result.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    return z.NEVER;
  }

  const result = hotelDetails.safeParse(value);
  if (!result.success) {
    for (const issue of result.error.issues) {
      context.addIssue({ code: 'custom', path: issue.path[0] === 'amenities' ? ['amenities'] : issue.path, message: issue.message });
    }
    return z.NEVER;
  }

  const { name, address, cityId, description, starRating } = result.data;
  const optionalAmenities = result.data.amenities;
  return {
    type: 'hotel',
    body: { name, address, cityId, description, starRating, ...(optionalAmenities.length ? { amenities: optionalAmenities } : {}) },
  };
});

export type ProviderFormValues = z.input<typeof providerFormSchema>;
export type ProviderDraft = z.output<typeof providerFormSchema>;
