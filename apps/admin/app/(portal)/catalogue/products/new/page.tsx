import { ActionForm, Button, Card, EmptyState, Field, Input, PageHeader, Select, SubmitButton, Textarea } from '@vendra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { session } from '../../../../../lib/session';
import { createProduct } from '../actions';
import { AttributeFields } from '../attribute-fields';

export const metadata: Metadata = { title: 'Add product · Vendra Admin' };

export default async function NewProductPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { categoryId } = await searchParams;
  const [categories, brands] = await Promise.all([
    session.read((api) => api.GET('/v1/admin/categories')),
    session.read((api) => api.GET('/v1/admin/brands')),
  ]);
  const category = categories.find((entry) => entry.id === categoryId);

  if (categories.length === 0) {
    return (
      <>
        <PageHeader title="Add product" />
        <EmptyState title="Create a category first">
          Every product belongs to a category, which decides the details it needs.{' '}
          <Link className="underline" href="/catalogue/categories">
            Go to categories
          </Link>
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Add product" description="New products start as drafts. Customers cannot see them until they are published." />
      <Card className="mb-6 max-w-2xl">
        {/* A plain GET form, so choosing a category works without JavaScript. */}
        <form method="get" className="flex flex-wrap items-end gap-3">
          <Field label="1. Category" className="min-w-64 flex-1">
            <Select name="categoryId" defaultValue={category?.id ?? ''} required>
              <option value="" disabled>
                Choose a category
              </option>
              {categories.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="outline">
            {category ? 'Change' : 'Continue'}
          </Button>
        </form>
      </Card>

      {category ? (
        <Card className="max-w-2xl">
          <h2 className="mb-4 font-semibold">2. Details for {category.name}</h2>
          <ActionForm action={createProduct} className="space-y-4">
            <input type="hidden" name="categoryId" value={category.id} />
            <Field label="Name">
              <Input name="name" required minLength={2} maxLength={300} />
            </Field>
            <Field label="Web address" hint="Optional. Leave blank to create one from the name.">
              <Input name="slug" maxLength={100} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="e.g. ankara-print-shirt" />
            </Field>
            <Field label="Brand">
              <Select name="brandId" defaultValue="">
                <option value="">No brand</option>
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Description">
              <Textarea name="description" maxLength={10_000} rows={5} />
            </Field>
            <AttributeFields definitions={category.attributes} />
            <SubmitButton>Create draft</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
    </>
  );
}
