import { z } from 'zod';
import type { CreateModeratorBody, ProviderQuery } from '@/api/admin';

export const moderatorRoles = {
  AIRLINE_MODERATOR: { label: 'Airline moderator', type: 'airline' },
  HOTEL_MODERATOR: { label: 'Hotel moderator', type: 'hotel' },
} satisfies Record<CreateModeratorBody['role'], { label: string; type: ProviderQuery['type'] }>;

export const moderatorFormSchema = z.object({
  name: z.string().trim().min(1, 'Enter a full name.').max(100, 'Use at most 100 characters.'),
  email: z.string().trim().toLowerCase()
    .pipe(z.email({ error: 'Enter a valid email address.' }).max(254, 'Use at most 254 characters.')),
  role: z.string().pipe(z.enum(['AIRLINE_MODERATOR', 'HOTEL_MODERATOR'], { error: 'Choose a moderator role.' })),
  provider: z.object({
    id: z.string().regex(/^[a-f0-9]{24}$/i, 'Choose a valid provider.'),
    name: z.string(),
    isActive: z.boolean(),
    kind: z.enum(['airline', 'hotel']),
  }).nullable(),
  temporaryPassword: z.string()
    .refine((value) => [...value].length >= 8, 'Use at least eight characters.')
    .regex(/\p{L}/u, 'Include at least one letter.')
    .regex(/[0-9]/, 'Include at least one digit.')
    .refine((value) => new TextEncoder().encode(value).length <= 72, 'Use at most 72 UTF-8 bytes.'),
}).superRefine(({ role, provider }, context) => {
  if (!provider || provider.kind !== moderatorRoles[role].type) {
    context.addIssue({ code: 'custom', path: ['provider'], message: 'Choose a provider for the selected role.' });
  }
});

export type ModeratorForm = z.input<typeof moderatorFormSchema>;
