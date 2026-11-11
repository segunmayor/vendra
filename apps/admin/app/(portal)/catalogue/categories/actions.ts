'use server';

import type { FormState } from '@vendra/ui';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isUuid, readDefinitions } from '../../../../lib/catalogue';
import { invalid, optionalText, text, toFormState } from '../../../../lib/forms';
import { session } from '../../../../lib/session';

export async function createCategory(_state: FormState, data: FormData): Promise<FormState> {
  const parentId = text(data, 'parentId');
  const result = await session.mutate((api) =>
    api.POST('/v1/admin/categories', {
      body: {
        name: text(data, 'name'),
        slug: optionalText(data, 'slug'),
        parentId: isUuid(parentId) ? parentId : null,
        attributes: readDefinitions(data),
      },
    }),
  );
  if (!result.ok) return invalid(result.message);
  revalidatePath('/catalogue/categories');
  redirect(`/catalogue/categories/${result.data.id}`);
}

export async function updateCategory(categoryId: string, _state: FormState, data: FormData): Promise<FormState> {
  const result = await session.mutate((api) =>
    api.PATCH('/v1/admin/categories/{id}', {
      params: { path: { id: categoryId } },
      body: { name: text(data, 'name'), attributes: readDefinitions(data) },
    }),
  );
  revalidatePath('/catalogue/categories');
  revalidatePath(`/catalogue/categories/${categoryId}`);
  return toFormState(result, 'Category saved');
}
