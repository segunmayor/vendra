import { EmptyState } from '@vendra/ui';
import Link from 'next/link';
import { listProducts, type ProductQuery } from '../lib/catalogue';
import { ProductGrid } from './catalogue';

/** A page of products with a link to the next. Returns null when the category or brand does not exist. */
export async function ProductResults({
  query,
  path,
  label,
  empty,
}: {
  query: ProductQuery;
  path: string;
  label: string;
  empty: { title: string; body: string };
}) {
  const page = await listProducts(query);
  if (page === 'not_found') return null;
  const link = (cursor?: string) => {
    const params = new URLSearchParams();
    if (query.q) params.set('q', query.q);
    if (query.brand) params.set('brand', query.brand);
    if (cursor) params.set('cursor', cursor);
    const search = params.toString();
    return search ? `${path}?${search}` : path;
  };

  if (page === 'expired') {
    return (
      <p className="text-sm">
        This page link has expired.{' '}
        <Link href={link()} className="font-semibold text-primary underline">
          Go to the first page
        </Link>
      </p>
    );
  }
  if (page.items.length === 0) {
    return (
      <>
        <EmptyState title={query.cursor ? 'No more products' : empty.title}>{empty.body}</EmptyState>
        {query.cursor ? (
          <p className="mt-4 text-center text-sm">
            <Link href={link()} className="font-semibold text-primary underline">
              Back to the first page
            </Link>
          </p>
        ) : null}
      </>
    );
  }
  return (
    <>
      <ProductGrid products={page.items} label={label} />
      <nav aria-label="Pages" className="mt-10 flex justify-center gap-6 text-sm font-semibold">
        {query.cursor ? (
          <Link href={link()} className="text-primary underline">
            First page
          </Link>
        ) : null}
        {page.nextCursor ? (
          <Link href={link(page.nextCursor)} className="rounded-full border border-border bg-surface px-6 py-3 text-primary">
            Show more
          </Link>
        ) : null}
      </nav>
    </>
  );
}
