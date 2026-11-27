'use server';

import type { components } from '@vendra/api-client';
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

/** The usual price shown struck through. Empty means no discount. The API repeats the check. */
function readWasPrice(data: FormData, priceMinor: string): { ok: true; value: string | null } | { ok: false; message: string } {
  const raw = text(data, 'wasPrice');
  if (!raw) return { ok: true, value: null };
  const value = nairaToKobo(raw);
  if (!value) return { ok: false, message: 'Enter the was-price in naira, such as 18000, or leave it empty' };
  if (BigInt(value) <= BigInt(priceMinor)) return { ok: false, message: 'The was-price must be higher than the price, or left empty' };
  return { ok: true, value };
}

export async function createListing(productId: string, variantId: string, _state: FormState, data: FormData): Promise<FormState> {
  const priceMinor = readPrice(data);
  if (!priceMinor) return invalid('Enter a price in naira, such as 15000 or 15,000.50');
  const wasPrice = readWasPrice(data, priceMinor);
  if (!wasPrice.ok) return invalid(wasPrice.message);
  const result = await session.mutate((api) =>
    api.POST('/v1/admin/listings', { body: { variantId, priceMinor, currency: 'NGN', compareAtMinor: wasPrice.value } }),
  );
  revalidatePath(productPath(productId));
  return toFormState(result, 'Price set. Activate the listing to offer it for sale.');
}

export async function setListingPrice(productId: string, listingId: string, _state: FormState, data: FormData): Promise<FormState> {
  const priceMinor = readPrice(data);
  if (!priceMinor) return invalid('Enter a price in naira, such as 15000 or 15,000.50');
  const wasPrice = readWasPrice(data, priceMinor);
  if (!wasPrice.ok) return invalid(wasPrice.message);
  const result = await session.mutate((api) =>
    api.PUT('/v1/admin/listings/{id}/price', {
      params: { path: { id: listingId } },
      // An empty was-price sends null, which removes the discount.
      body: { priceMinor, currency: 'NGN', compareAtMinor: wasPrice.value },
    }),
  );
  revalidatePath(productPath(productId));
  return toFormState(result, wasPrice.value ? 'Price and was-price updated' : 'Price updated');
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

const MAX_PHOTOS = 10;

/** Uploads one or more photos from the computer, in the order chosen. */
export async function uploadPhotos(productId: string, room: number, _state: FormState, data: FormData): Promise<FormState> {
  const files = data.getAll('files').filter((file): file is File => file instanceof File && file.size > 0);
  if (files.length === 0) return invalid('Choose one or more photos');
  if (files.length > room) return invalid(room === 0 ? `A product can have at most ${MAX_PHOTOS} photos. Remove one first.` : `There is room for ${room} more ${room === 1 ? 'photo' : 'photos'}.`);
  let added = 0;
  for (const file of files) {
    const form = new FormData();
    form.set('file', file, file.name);
    const result = await session.mutate((api) =>
      api.POST('/v1/admin/products/{id}/images', {
        params: { path: { id: productId } },
        // The generated type describes the parts; the client sends the FormData as it is.
        body: form as unknown as components['schemas']['UploadPhotoDto'],
        bodySerializer: (body) => body as unknown as FormData,
      }),
    );
    if (!result.ok) {
      revalidatePath(productPath(productId));
      return invalid(added ? `${added} added. ${file.name}: ${result.message}` : `${file.name}: ${result.message}`);
    }
    added++;
  }
  revalidatePath(productPath(productId));
  return { status: 'success', message: added === 1 ? 'Photo added.' : `${added} photos added.` };
}

export async function addPhotoFromUrl(productId: string, _state: FormState, data: FormData): Promise<FormState> {
  const url = text(data, 'url');
  if (!url) return invalid('Enter the photo address');
  const result = await session.mutate((api) =>
    api.POST('/v1/admin/products/{id}/images/from-url', { params: { path: { id: productId } }, body: { url } }),
  );
  revalidatePath(productPath(productId));
  return toFormState(result, 'Photo added.');
}

/**
 * Saves a new order, or a removal. The page works out the list; the API accepts only photos the
 * product has. Success shows as the new order itself, so only failures carry a message.
 */
export async function arrangePhotos(productId: string, images: string[], _state: FormState): Promise<FormState> {
  const result = await session.mutate((api) =>
    api.PUT('/v1/admin/products/{id}/images', { params: { path: { id: productId } }, body: { images } }),
  );
  revalidatePath(productPath(productId));
  return result.ok ? { status: 'success' } : invalid(result.message);
}

/** Saves a new video order, or a removal. Only videos the product has are accepted by the API. */
export async function arrangeVideos(productId: string, videos: string[], _state: FormState): Promise<FormState> {
  const result = await session.mutate((api) =>
    api.PUT('/v1/admin/products/{id}/videos', { params: { path: { id: productId } }, body: { videos } }),
  );
  revalidatePath(productPath(productId));
  return result.ok ? { status: 'success' } : invalid(result.message);
}
