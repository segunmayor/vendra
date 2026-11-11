import { ActionForm, Card, EmptyState, Field, Input, PageHeader, Select, SubmitButton, Table, Td } from '@vendra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { session } from '../../../../lib/session';
import { createCategory } from './actions';
import { AttributeRows } from './attribute-rows';

export const metadata: Metadata = { title: 'Categories · Vendra Admin' };

export default async function CategoriesPage() {
  const categories = await session.read((api) => api.GET('/v1/admin/categories'));
  const name = new Map(categories.map((category) => [category.id, category.name]));

  return (
    <>
      <PageHeader title="Categories" description="Categories group products for shoppers and decide which details each product needs." />
      {categories.length === 0 ? (
        <EmptyState title="No categories yet">Create the first category below.</EmptyState>
      ) : (
        <Table caption="Categories" head={['Category', 'Parent', 'Web address', 'Details asked for']}>
          {categories.map((category) => (
            <tr key={category.id}>
              <Td>
                <Link href={`/catalogue/categories/${category.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                  {category.name}
                </Link>
              </Td>
              <Td>{category.parentId ? (name.get(category.parentId) ?? '—') : '—'}</Td>
              <Td className="text-muted">/{category.slug}</Td>
              <Td>{category.attributes.map((attribute) => attribute.label).join(', ') || '—'}</Td>
            </tr>
          ))}
        </Table>
      )}

      <Card className="mt-8">
        <h2 className="mb-4 text-lg font-semibold">New category</h2>
        <ActionForm action={createCategory} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name">
              <Input name="name" required minLength={2} maxLength={200} />
            </Field>
            <Field label="Web address" hint="Optional. Made from the name if blank.">
              <Input name="slug" maxLength={100} pattern="[a-z0-9]+(-[a-z0-9]+)*" />
            </Field>
            <Field label="Inside">
              <Select name="parentId" defaultValue="">
                <option value="">Top level</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <AttributeRows />
          <SubmitButton>Create category</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
