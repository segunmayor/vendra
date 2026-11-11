'use server';

import type { FormState } from '@vendra/ui';
import { revalidatePath } from 'next/cache';
import { addToCart, setCartQuantity } from '../../lib/cart';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function read(data: FormData) {
  const listingId = String(data.get('listingId') ?? '');
  const quantity = Number(data.get('quantity'));
  return { listingId, quantity, valid: UUID.test(listingId) && Number.isInteger(quantity) && quantity >= 0 && quantity <= 10 };
}

export async function addItem(_state: FormState, data: FormData): Promise<FormState> {
  const { listingId, quantity, valid } = read(data);
  if (!valid || quantity < 1) return { status: 'error', message: 'Choose how many you want' };
  const result = await addToCart(listingId, quantity);
  if (!result.ok) return { status: 'error', message: result.message };
  revalidatePath('/', 'layout');
  return { status: 'success', message: `Added to your basket. You have ${result.cart.itemCount} ${result.cart.itemCount === 1 ? 'item' : 'items'}.` };
}

export async function updateItem(_state: FormState, data: FormData): Promise<FormState> {
  const { listingId, quantity, valid } = read(data);
  if (!valid) return { status: 'error', message: 'Choose a quantity from 0 to 10' };
  const result = await setCartQuantity(listingId, quantity);
  if (!result.ok) return { status: 'error', message: result.message };
  revalidatePath('/', 'layout');
  return { status: 'success', message: quantity === 0 ? 'Removed' : 'Updated' };
}
