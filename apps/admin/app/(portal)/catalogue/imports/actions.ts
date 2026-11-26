'use server';

import type { components } from '@vendra/api-client';
import type { FormState } from '@vendra/ui';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isUuid } from '../../../../lib/catalogue';
import { invalid, text, toFormState } from '../../../../lib/forms';
import { session } from '../../../../lib/session';

const MODES = ['create_and_update', 'create_only'] as const;
type Mode = (typeof MODES)[number];
const HOME = '/catalogue/imports';
const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** Checks the file in the API. Nothing is created until the import is started on its page. */
export async function uploadImport(maxBytes: number, _state: FormState, data: FormData): Promise<FormState> {
  const file = data.get('file');
  if (!(file instanceof File) || file.size === 0) return invalid('Choose a CSV file to upload');
  if (file.size > maxBytes) return invalid(`That file is ${megabytes(file.size)}. Product files can be up to ${megabytes(maxBytes)}.`);
  const mode = text(data, 'mode') as Mode;
  if (!MODES.includes(mode)) return invalid('Choose what to do with products that already exist');

  const form = new FormData();
  form.set('mode', mode);
  form.set('file', file, file.name);
  const result = await session.mutate((api) =>
    api.POST('/v1/admin/product-imports', {
      // The generated type describes the parts; the client sends the FormData as it is.
      body: form as unknown as components['schemas']['UploadImportDto'],
      bodySerializer: (body) => body as unknown as FormData,
    }),
  );
  if (!result.ok) return invalid(result.message);
  revalidatePath(HOME);
  redirect(`${HOME}/${result.data.id}`);
}

export async function startImport(id: string, _state: FormState): Promise<FormState> {
  if (!isUuid(id)) return invalid('Import not found');
  const result = await session.mutate((api) => api.POST('/v1/admin/product-imports/{id}/start', { params: { path: { id } } }));
  revalidatePath(`${HOME}/${id}`);
  revalidatePath(HOME);
  return toFormState(result, 'Import started. This page updates as products are added.');
}

export async function cancelImport(id: string, _state: FormState): Promise<FormState> {
  if (!isUuid(id)) return invalid('Import not found');
  const result = await session.mutate((api) => api.POST('/v1/admin/product-imports/{id}/cancel', { params: { path: { id } } }));
  revalidatePath(`${HOME}/${id}`);
  revalidatePath(HOME);
  return toFormState(result, 'Import stopped. Products already imported stay.');
}
