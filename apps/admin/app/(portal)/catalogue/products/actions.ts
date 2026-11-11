'use server';

import type { FormState } from '@vendra/ui';
import { nairaToKobo } from '@vendra/utils';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isUuid, readAttributes, readOptions } from '../../../../lib/catalogue';
import { invalid, optionalText, text, toFormState } from '../../../../lib/forms';
import { session } from '../../../../lib/session';

const ADJUSTMENT_REASONS = ['receipt', 'correction', 'damaged', 'lost', 'returned'] as const;
type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

const productPath = (id: string) => `/catalogue/products/${id}`;

async function categoryAttributes(categoryId: string) {
  const categories = await session.mutate((api) => api.GET('/v1/admin/categories'));
  if (!categories.ok) return categories;
  const category = categories.data.find((entry) => entry.id === categoryId);
  return category ? { ok: true as const, data: category.attributes } : { ok: false as const, message: 'That category no longer exists' };
}

export async function createProduct(_state: FormState, data: FormData): Promise<FormState> {
  const categoryId = text(data, 'categoryId');
  if (!isUuid(categoryId)) return invalid('Choose a category');
  const definitions = await categoryAttributes(categoryId);
  if (!definitions.ok) return invalid(definitions.message);
  const attributes = readAttributes(definitions.data, data);
  if (!attributes.ok) return invalid(attributes.message);
  const brandId = text(data, 'brandId');

  const result = await session.mutate((api) =>
    api.POST('/v1/admin/products', {
      body: {
        categoryId,
        name: text(data, 'name'),
        slug: optionalText(data, 'slug'),
        description: text(data, 'description'),
        brandId: isUuid(brandId) ? brandId : null,
        attributes: attributes.values,
      },
    }),
  );
  if (!result.ok) return invalid(result.message);
  revalidatePath('/catalogue/products');
  redirect(productPath(result.data.id));
}

export async function updateProduct(productId: string, categoryId: string, _state: FormState, data: FormData): Promise<FormState> {
  const definitions = await categoryAttributes(categoryId);
  if (!definitions.ok) return invalid(definitions.message);
  const attributes = readAttributes(definitions.data, data);
  if (!attributes.ok) return invalid(attributes.message);
  const brandId = text(data, 'brandId');
  const result = await session.mutate((api) =>
    api.PATCH('/v1/admin/products/{id}', {
      params: { path: { id: productId } },
      body: {
        name: text(data, 'name'),
        description: text(data, 'description'),
        brandId: isUuid(brandId) ? brandId : null,
        attributes: attributes.values,
      },
    }),
  );
  revalidatePath(productPath(productId));
  return toFormState(result, 'Product saved');
}

export async function addVariant(productId: string, _state: FormState, data: FormData): Promise<FormState> {
  const weight = Number(text(data, 'weightGrams'));
  if (!Number.isInteger(weight) || weight <= 0) return invalid('Enter the packed weight in whole grams');
  const options = readOptions(text(data, 'options'));
  if (!options.ok) return invalid(options.message);
  const result = await session.mutate((api) =>
    api.POST('/v1/admin/products/{id}/variants', {
      params: { path: { id: productId } },
      body: { sku: text(data, 'sku'), weightGrams: weight, options: options.options },
    }),
  );
  revalidatePath(productPath(productId));
  return toFormState(result, 'Variant added');
}

export async function publishProduct(productId: string, _state: FormState): Promise<FormState> {
  const result = await session.mutate((api) =>
    api.POST('/v1/admin/products/{id}/publish', { params: { path: { id: productId } } }),
  );
  revalidatePath(productPath(productId));
  return toFormState(result, 'Product published');
}

export async function archiveProduct(productId: string, _state: FormState): Promise<FormState> {
  const result = await session.mutate((api) =>
    api.POST('/v1/admin/products/{id}/archive', { params: { path: { id: productId } } }),
  );
  revalidatePath(productPath(productId));
  return toFormState(result, 'Product archived. Its listings can no longer be activated.');
}

function readPrice(data: FormData): string | null {
  const kobo = nairaToKobo(text(data, 'price'));
  return kobo && kobo !== '0' ? kobo : null;
}

export async function createListing(productId: string, variantId: string, _state: FormState, data: FormData): Promise<FormState> {
  const priceMinor = readPrice(data);
  if (!priceMinor) return invalid('Enter a price in naira, such as 15000 or 15,000.50');
  const result = await session.mutate((api) =>
    api.POST('/v1/admin/listings', { body: { variantId, priceMinor, currency: 'NGN' } }),
  );
  revalidatePath(productPath(productId));
  return toFormState(result, 'Price set. Activate the listing to offer it for sale.');
}

export async function setListingPrice(productId: string, listingId: string, _state: FormState, data: FormData): Promise<FormState> {
  const priceMinor = readPrice(data);
  if (!priceMinor) return invalid('Enter a price in naira, such as 15000 or 15,000.50');
  const result = await session.mutate((api) =>
    api.PUT('/v1/admin/listings/{id}/price', { params: { path: { id: listingId } }, body: { priceMinor, currency: 'NGN' } }),
  );
  revalidatePath(productPath(productId));
  return toFormState(result, 'Price updated');
}

export async function setListingActive(productId: string, listingId: string, active: boolean, _state: FormState): Promise<FormState> {
  const result = await session.mutate((api) =>
    active
      ? api.POST('/v1/admin/listings/{id}/activate', { params: { path: { id: listingId } } })
      : api.POST('/v1/admin/listings/{id}/deactivate', { params: { path: { id: listingId } } }),
  );
  revalidatePath(productPath(productId));
  return toFormState(result, active ? 'Listing is on sale' : 'Listing taken off sale');
}

/**
 * The idempotency key is rendered into the form, so a double submit or a retry after a
 * timeout applies the adjustment once. Each successful save renders a fresh key.
 */
export async function adjustStock(productId: string, listingId: string, _state: FormState, data: FormData): Promise<FormState> {
  const warehouseId = text(data, 'warehouseId');
  const key = text(data, 'idempotencyKey');
  const reason = text(data, 'reason') as AdjustmentReason;
  const quantity = Number(text(data, 'quantity'));
  if (!isUuid(warehouseId)) return invalid('Choose a warehouse');
  if (!ADJUSTMENT_REASONS.includes(reason)) return invalid('Choose a reason');
  if (!Number.isInteger(quantity) || quantity <= 0) return invalid('Enter a whole number of units, more than zero');
  const direction = text(data, 'direction');
  if (direction !== 'add' && direction !== 'remove') return invalid('Choose whether to add or remove stock');
  const delta = direction === 'add' ? quantity : -quantity;

  const result = await session.mutate((api) =>
    api.POST('/v1/admin/stock/adjustments', {
      params: { header: { 'Idempotency-Key': key } },
      body: { listingId, warehouseId, delta, reason },
    }),
  );
  revalidatePath(productPath(productId));
  return toFormState(result, result.ok ? `Stock updated. ${result.data.available} available.` : '');
}
