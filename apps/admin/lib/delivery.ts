import 'server-only';
import { nairaToKobo } from '@vendra/utils';

export const STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo',
  'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa',
  'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
] as const;

export const BAND_ROWS = 5;

type State = (typeof STATES)[number];
const isState = (value: string): value is State => (STATES as readonly string[]).includes(value);

/** Reads the zone form: states as checkboxes, bands as "up to N kg costs ₦X" rows. Blank rows are skipped. */
export function readZone(data: FormData) {
  const states = data.getAll('states').map(String).filter(isState);
  const rates: { maxWeightGrams: number; priceMinor: string }[] = [];
  for (let index = 0; index < BAND_ROWS; index += 1) {
    const kg = String(data.get(`band.${index}.kg`) ?? '').trim();
    const price = String(data.get(`band.${index}.price`) ?? '').trim();
    if (!kg && !price) continue;
    const grams = Math.round(Number(kg) * 1000);
    const kobo = nairaToKobo(price);
    if (!Number.isFinite(grams) || grams <= 0) return { ok: false as const, message: `Band ${index + 1}: enter a weight in kg, such as 2 or 0.5` };
    if (kobo === null) return { ok: false as const, message: `Band ${index + 1}: enter a price in naira, such as 2500` };
    rates.push({ maxWeightGrams: grams, priceMinor: kobo });
  }
  return {
    ok: true as const,
    zone: { code: String(data.get('code') ?? '').trim(), name: String(data.get('name') ?? '').trim(), states, rates },
  };
}
