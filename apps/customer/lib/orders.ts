/** How each order status reads to a customer. */
export const ORDER_STATUS: Record<string, { label: string; note: string }> = {
  placed: { label: 'Confirmed', note: 'We are preparing your order for delivery.' },
  stock_issue: { label: 'Refund due', note: 'An item sold out before your payment reached us. We will refund you in full and contact you.' },
  cancelled: { label: 'Cancelled', note: 'This order was cancelled.' },
  fulfilled: { label: 'Delivered', note: 'Your order has been delivered.' },
};

export const orderDate = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: 'Africa/Lagos' });
