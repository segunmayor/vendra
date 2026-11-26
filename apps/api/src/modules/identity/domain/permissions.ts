/** Every staff permission. Handlers check these, never role names. */
export const PERMISSIONS = [
  'staff.manage',
  'roles.manage',
  'audit.read',
  'catalogue.manage',
  'catalogue.import',
  'inventory.manage',
  'orders.manage',
  'orders.refund',
  'payments.read',
  'shipments.manage',
  'vendors.approve',
  'settings.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
