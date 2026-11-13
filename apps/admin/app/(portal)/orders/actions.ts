'use server';

import type { FormState } from '@vendra/ui';
import { revalidatePath } from 'next/cache';
import { invalid, optionalText, text, toFormState } from '../../../lib/forms';
import { session } from '../../../lib/session';
import { SHIPMENT_STATUSES, type ShipmentStatus } from './labels';

export async function sendItems(orderId: string, sellerOrderId: string, _state: FormState, data: FormData): Promise<FormState> {
  const courier = text(data, 'courier');
  if (courier.length < 2) return invalid('Say who is delivering these items');
  const result = await session.mutate((api) =>
    api.POST('/v1/admin/seller-orders/{id}/shipments', {
      params: { path: { id: sellerOrderId } },
      body: { courier, trackingReference: optionalText(data, 'trackingReference'), note: optionalText(data, 'note') },
    }),
  );
  revalidatePath(`/orders/${orderId}`);
  return toFormState(result, result.ok ? `Handed to ${result.data.courier}. Tracking ${result.data.trackingReference}.` : '');
}

export async function moveShipment(orderId: string, shipmentId: string, version: number, _state: FormState, data: FormData): Promise<FormState> {
  const status = text(data, 'status') as ShipmentStatus;
  if (!SHIPMENT_STATUSES.includes(status)) return invalid('Choose what happened');
  const note = optionalText(data, 'note');
  if (status === 'delivery_failed' && (note?.length ?? 0) < 3) return invalid('Say why the delivery failed');
  const result = await session.mutate((api) => api.POST('/v1/admin/shipments/{id}/status', { params: { path: { id: shipmentId } }, body: { status, note, version } }));
  revalidatePath(`/orders/${orderId}`);
  revalidatePath('/shipments');
  return toFormState(result, 'Saved.');
}
