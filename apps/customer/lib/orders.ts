/** How each order status reads to a customer. */
export const ORDER_STATUS: Record<string, { label: string; note: string }> = {
  placed: { label: 'Confirmed', note: 'We are preparing your order for delivery.' },
  stock_issue: { label: 'Refund due', note: 'An item sold out before your payment reached us. We will refund you in full and contact you.' },
  cancelled: { label: 'Cancelled', note: 'This order was cancelled.' },
  fulfilled: { label: 'Delivered', note: 'Your order has been delivered.' },
};

export const orderDate = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: 'Africa/Lagos' });

/** How each shipment step reads to a customer. */
export const SHIPMENT_STEP: Record<string, string> = {
  created: 'Packed',
  allocated: 'Packed and handed to the courier',
  picked_up: 'Collected by the courier',
  in_transit: 'On the way',
  out_for_delivery: 'Out for delivery today',
  delivered: 'Delivered',
  delivery_failed: 'The courier could not deliver. We will contact you',
  returning: 'Coming back to us',
  returned: 'Back with us. We will contact you to arrange delivery',
  cancelled: 'Delivery cancelled',
};

export const STAGES = ['Confirmed', 'Packed', 'On the way', 'Delivered'] as const;

/** Which stage of `STAGES` the order has reached, from its status and latest shipment. */
export function stageOf(orderStatus: string, latestShipment: string | undefined): number {
  if (orderStatus === 'fulfilled') return 3;
  if (!latestShipment || latestShipment === 'cancelled' || latestShipment === 'returned') return 0;
  if (latestShipment === 'created' || latestShipment === 'allocated') return 1;
  return 2;
}

export const stepTime = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' });
