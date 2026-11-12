import type { Tone } from '@vendra/ui';

export const ORDER_STATUSES = ['placed', 'stock_issue', 'cancelled', 'fulfilled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_LABEL: Record<OrderStatus, string> = {
  placed: 'To send',
  stock_issue: 'Stock issue: refund',
  cancelled: 'Cancelled',
  fulfilled: 'Delivered',
};

export const ORDER_TONE: Record<OrderStatus, Tone> = { placed: 'warning', stock_issue: 'danger', cancelled: 'neutral', fulfilled: 'success' };

export const SELLER_LABEL: Record<string, string> = { pending: 'Waiting to be sent', dispatched: 'Sent', delivered: 'Delivered', cancelled: 'Cancelled' };

export const dateTime = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' });
