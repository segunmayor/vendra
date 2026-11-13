'use server';

import type { components } from '@vendra/api-client';
import type { FormState } from '@vendra/ui';
import { revalidatePath } from 'next/cache';
import { invalid, optionalText, text, toFormState } from '../../lib/forms';
import { megabytes, type DocumentKind } from '../../lib/labels';
import { session } from '../../lib/session';
import { isState } from '../../lib/states';

const HOME = '/';
const KINDS: readonly DocumentKind[] = ['registration_certificate', 'owner_id', 'proof_of_address', 'tax_certificate', 'other'];

export async function saveDetails(version: number | null, _state: FormState, data: FormData): Promise<FormState> {
  const businessKind = text(data, 'businessKind');
  if (businessKind !== 'company' && businessKind !== 'business_name') return invalid('Choose whether you are a registered company or a business name');
  const state = text(data, 'state');
  if (!isState(state)) return invalid('Choose the state your business is in');
  const body: components['schemas']['SaveDetailsDto'] = {
    displayName: text(data, 'displayName'),
    legalName: text(data, 'legalName'),
    businessKind,
    registrationNumber: text(data, 'registrationNumber'),
    taxId: optionalText(data, 'taxId') ?? null,
    phone: text(data, 'phone'),
    address: { line1: text(data, 'line1'), line2: optionalText(data, 'line2') ?? null, city: text(data, 'city'), state },
    description: optionalText(data, 'description') ?? null,
    ...(version === null ? {} : { version }),
  };
  const result = await session.mutate((api) => api.PUT('/v1/vendor/application', { body }));
  revalidatePath(HOME);
  return toFormState(result, version === null ? 'Saved. Now attach your documents.' : 'Details saved.');
}

export async function uploadDocument(maxBytes: number, _state: FormState, data: FormData): Promise<FormState> {
  const kind = text(data, 'kind') as DocumentKind;
  if (!KINDS.includes(kind)) return invalid('Choose what the document is');
  const file = data.get('file');
  if (!(file instanceof File) || file.size === 0) return invalid('Choose a file to upload');
  if (file.size > maxBytes) return invalid(`That file is ${megabytes(file.size)}. Files can be up to ${megabytes(maxBytes)}.`);

  const form = new FormData();
  form.set('kind', kind);
  form.set('file', file, file.name);
  const result = await session.mutate((api) =>
    api.POST('/v1/vendor/application/documents', {
      // The generated type describes the parts; the client sends the FormData as it is.
      body: form as unknown as components['schemas']['UploadDto'],
      bodySerializer: (body) => body as unknown as FormData,
    }),
  );
  revalidatePath(HOME);
  return toFormState(result, `${file.name} attached.`);
}

export async function removeDocument(documentId: string, _state: FormState): Promise<FormState> {
  const result = await session.mutate((api) => api.DELETE('/v1/vendor/application/documents/{documentId}', { params: { path: { documentId } } }));
  revalidatePath(HOME);
  return toFormState(result, 'Removed.');
}

export async function submitApplication(version: number, _state: FormState): Promise<FormState> {
  const result = await session.mutate((api) => api.POST('/v1/vendor/application/submit', { body: { version } }));
  revalidatePath(HOME);
  return toFormState(result, 'Sent. We will review your application and let you know here.');
}
