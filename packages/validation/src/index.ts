import { z } from 'zod';

/** Input checks for forms. The API re-validates everything. */

export const emailSchema = z.email('Enter a valid email address').trim().toLowerCase();

/** Accepts 0803..., 234803... or +234803..., and normalizes to +234 format. */
export const nigerianPhoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .refine((value) => /^(?:\+?234|0)[789][01]\d{8}$/.test(value), 'Enter a valid Nigerian phone number')
  .transform((value) => `+234${value.replace(/^(?:\+?234|0)/, '')}`);

export const passwordSchema = z.string().min(12, 'Use at least 12 characters').max(128);

export const addressSchema = z.object({
  recipient: z.string().trim().min(2, 'Enter the recipient name'),
  phone: nigerianPhoneSchema,
  line1: z.string().trim().min(3, 'Enter the street address'),
  line2: z.string().trim().optional(),
  city: z.string().trim().min(2, 'Enter the city'),
  state: z.string().trim().min(2, 'Select a state'),
});

export type AddressInput = z.infer<typeof addressSchema>;
