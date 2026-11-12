import { ActionForm, Card, EmptyState, Field, Input, PageHeader, SubmitButton, Table, Td } from '@vendra/ui';
import type { FormState } from '@vendra/ui';
import type { Metadata } from 'next';
import { revalidatePath } from 'next/cache';
import { text, toFormState } from '../../../../lib/forms';
import { session } from '../../../../lib/session';

export const metadata: Metadata = { title: 'Brands' };

async function createBrand(_state: FormState, data: FormData): Promise<FormState> {
  'use server';
  const result = await session.mutate((api) => api.POST('/v1/admin/brands', { body: { name: text(data, 'name') } }));
  revalidatePath('/catalogue/brands');
  return toFormState(result, 'Brand added');
}

export default async function BrandsPage() {
  const brands = await session.read((api) => api.GET('/v1/admin/brands'));
  return (
    <>
      <PageHeader title="Brands" description="Optional. Shoppers can filter by brand." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {brands.length === 0 ? (
          <EmptyState title="No brands yet">Products without a brand are fine.</EmptyState>
        ) : (
          <Table caption="Brands" head={['Brand', 'Web address']}>
            {brands.map((brand) => (
              <tr key={brand.id}>
                <Td className="font-medium">{brand.name}</Td>
                <Td className="text-muted">/{brand.slug}</Td>
              </tr>
            ))}
          </Table>
        )}
        <Card>
          <h2 className="mb-3 font-semibold">Add a brand</h2>
          <ActionForm action={createBrand} className="space-y-3">
            <Field label="Name">
              <Input name="name" required minLength={2} maxLength={200} />
            </Field>
            <SubmitButton>Add brand</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
