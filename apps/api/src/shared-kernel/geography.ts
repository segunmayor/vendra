/** Nigeria's 36 states and the Federal Capital Territory, as customers write them. */
export const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta',
  'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi',
  'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto',
  'Taraba', 'Yobe', 'Zamfara',
] as const;

export type NigerianState = (typeof NIGERIAN_STATES)[number];

export function isNigerianState(value: string): value is NigerianState {
  return (NIGERIAN_STATES as readonly string[]).includes(value);
}

const MOBILE = /^(?:\+?234|0)([789][01]\d{8})$/;

/** A Nigerian mobile number as +234…, or null. Accepts 0803 123 4567, +2348031234567 and similar. */
export function nigerianMobile(raw: string): string | null {
  const match = MOBILE.exec(raw.replace(/[\s-]/g, ''));
  return match ? `+234${match[1]}` : null;
}
