/** Plain names for each permission, so roles are understandable without reading code. */
export const PERMISSION_LABEL: Record<string, string> = {
  'staff.manage': 'Add staff, change their roles, suspend them, reset two-step sign-in',
  'roles.manage': 'Create roles',
  'audit.read': 'Read the audit log',
  'catalogue.manage': 'Products, categories, brands and prices',
  'inventory.manage': 'Warehouses and stock',
  'orders.manage': 'See and manage orders',
  'orders.refund': 'Refund customers',
  'payments.read': 'See payments',
  'shipments.manage': 'Dispatch and track deliveries',
  'vendors.approve': 'Approve sellers',
  'settings.manage': 'Settings, delivery prices and payment gateways',
};
