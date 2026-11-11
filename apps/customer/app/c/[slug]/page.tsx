import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProductResults } from '../../../components/product-results';
import { SiteHeader } from '../../../components/site-header';
import { asSlug, listCategories } from '../../../lib/catalogue';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> };

async function findCategory(slug: string) {
  const categories = await listCategories();
  const category = categories.find((entry) => entry.slug === slug);
  return category ? { category, categories } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await findCategory((await params).slug);
  if (!found) return { title: 'Not found · Vendra' };
  return { title: `${found.category.name} · Vendra`, description: `Shop ${found.category.name} on Vendra with clear prices and tracked delivery.` };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const query = await searchParams;
  const found = await findCategory(slug);
  if (!found) notFound();
  const { category, categories } = found;
  const byId = new Map(categories.map((entry) => [entry.id, entry]));
  const trail = [];
  for (let current: typeof category | undefined = category; current; current = current.parentId ? byId.get(current.parentId) : undefined) {
    trail.unshift(current);
    if (trail.length > 10) break;
  }
  const children = categories.filter((entry) => entry.parentId === category.id);

  const results = await ProductResults({
    query: { category: category.slug, brand: asSlug(query.brand), cursor: query.cursor },
    path: `/c/${category.slug}`,
    label: category.name,
    empty: { title: 'Nothing here yet', body: 'Products in this category will appear here once they are on sale.' },
  });
  if (!results) notFound();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <nav aria-label="Breadcrumb" className="mb-2 text-sm text-muted">
          <ol className="flex flex-wrap gap-1">
            <li>
              <Link href="/" className="hover:underline">
                Home
              </Link>
            </li>
            {trail.slice(0, -1).map((entry) => (
              <li key={entry.id}>
                <span aria-hidden="true">/ </span>
                <Link href={`/c/${entry.slug}`} className="hover:underline">
                  {entry.name}
                </Link>
              </li>
            ))}
          </ol>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight">{category.name}</h1>
        {children.length > 0 ? (
          <ul aria-label="Subcategories" className="mt-4 flex flex-wrap gap-2">
            {children.map((child) => (
              <li key={child.id}>
                <Link href={`/c/${child.slug}`} className="inline-block rounded-full border border-border bg-surface px-4 py-1.5 text-sm hover:border-primary">
                  {child.name}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-8">{results}</div>
      </main>
    </>
  );
}
