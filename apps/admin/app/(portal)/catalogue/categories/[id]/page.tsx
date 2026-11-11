import { ActionForm, Card, Field, Input, PageHeader, SubmitButton } from '@vendra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { session } from '../../../../../lib/session';
import { updateCategory } from '../actions';
import { AttributeRows } from '../attribute-rows';

export const metadata: Metadata = { title: 'Category · Vendra Admin' };

export default async function CategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const categories = await session.read((api) => api.GET('/v1/admin/categories'));
  const category = categories.find((entry) => entry.id === id);
  if (!category) notFound();

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/catalogue/categories" className="text-muted underline underline-offset-2">
          Categories
        </Link>
      </p>
      <PageHeader title={category.name} description={`/${category.slug}`} />
      <Card>
        <ActionForm action={updateCategory.bind(null, category.id)} className="space-y-4">
          <Field label="Name" className="max-w-sm">
            <Input name="name" defaultValue={category.name} required minLength={2} maxLength={200} />
          </Field>
          <AttributeRows definitions={category.attributes} />
          <SubmitButton>Save category</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
