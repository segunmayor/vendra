import type { Tone } from '@vendra/ui';

export const ORDER_STATUSES = ['placed', 'stock_issue', 'cancelled', 'fulfilled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_LABEL: Record<OrderStatus, string> = {
  placed: 'On its way',
  stock_issue: 'Stock issue: refund',
  cancelled: 'Cancelled',
  fulfilled: 'Delivered',
};

export const ORDER_TONE: Record<OrderStatus, Tone> = { placed: 'neutral', stock_issue: 'danger', cancelled: 'neutral', fulfilled: 'success' };

/** An order's badge: paid orders with items still at Vendra read "To send". */
export function orderBadge(order: { status: string; toSend: boolean }): { label: string; tone: Tone } {
  if (order.toSend) return { label: 'To send', tone: 'warning' };
  return { label: ORDER_LABEL[order.status as OrderStatus] ?? order.status, tone: ORDER_TONE[order.status as OrderStatus] ?? 'neutral' };
}

export const SHIPMENT_STATUSES = ['created', 'allocated', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'delivery_failed', 'returning', 'returned', 'cancelled'] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const SHIPMENT_LABEL: Record<ShipmentStatus, string> = {
  created: 'Packed',
  allocated: 'With courier, waiting for collection',
  picked_up: 'Collected',
  in_transit: 'On the way',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  delivery_failed: 'Delivery failed',
  returning: 'Coming back',
  returned: 'Back at Vendra',
  cancelled: 'Cancelled',
};

export const SHIPMENT_TONE: Record<ShipmentStatus, Tone> = {
  created: 'neutral',
  allocated: 'warning',
  picked_up: 'neutral',
  in_transit: 'neutral',
  out_for_delivery: 'neutral',
  delivered: 'success',
  delivery_failed: 'danger',
  returning: 'warning',
  returned: 'neutral',
  cancelled: 'neutral',
};

/** The button that moves a shipment to each status. */
export const SHIPMENT_ACTION: Record<ShipmentStatus, string> = {
  created: 'Packed',
  allocated: 'Hand to courier',
  picked_up: 'Courier has collected it',
  in_transit: 'On the way',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  delivery_failed: 'Could not deliver',
  returning: 'Send it back to Vendra',
  returned: 'Back at Vendra',
  cancelled: 'Cancel shipment',
};

export const SELLER_LABEL: Record<string, string> = { pending: 'Waiting to be sent', dispatched: 'With the courier', delivered: 'Delivered', cancelled: 'Cancelled' };

export const dateTime = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' });
