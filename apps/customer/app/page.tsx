import Link from 'next/link';
import { ProductGrid } from '../components/catalogue';
import { SiteHeader } from '../components/site-header';
import { EmptyState } from '@vendra/ui';
import { listCategories, listProducts } from '../lib/catalogue';

export default async function HomePage() {
  const [result, categories] = await Promise.all([listProducts({ limit: 8 }), listCategories()]);
  const latest = typeof result === 'string' ? null : result;
  const top = categories.filter((category) => category.parentId === null);
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <section className="rounded-brand bg-primary px-6 py-12 text-primary-foreground md:px-12 md:py-16">
          <h1 className="max-w-xl text-3xl font-extrabold tracking-tight md:text-5xl">Everything you need, delivered with confidence.</h1>
          <p className="mt-4 max-w-lg text-base opacity-90">Clear prices, verified payments and delivery you can follow from checkout to your door.</p>
          <Link href="/products" className="mt-6 inline-block rounded-full bg-accent px-6 py-3 text-sm font-bold text-accent-foreground">
            Start shopping
          </Link>
        </section>

        {top.length > 0 ? (
          <section aria-labelledby="categories" className="mt-12">
            <h2 id="categories" className="text-xl font-bold">
              Shop by category
            </h2>
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {top.map((category) => (
                <li key={category.id}>
                  <Link href={`/c/${category.slug}`} className="block rounded-brand border border-border bg-surface px-4 py-5 font-semibold hover:border-primary">
                    {category.name}
                    <span className="mt-1 block text-xs font-normal text-muted">
                      {category.productCount} {category.productCount === 1 ? 'product' : 'products'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="latest" className="mt-12">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 id="latest" className="text-xl font-bold">
              New in
            </h2>
            {latest && latest.items.length > 0 ? (
              <Link href="/products" className="text-sm font-semibold text-primary underline">
                See all
              </Link>
            ) : null}
          </div>
          {latest && latest.items.length > 0 ? (
            <ProductGrid products={latest.items} label="New in" />
          ) : (
            <EmptyState title="Products are coming soon">The catalogue will appear here once products are on sale.</EmptyState>
          )}
        </section>
      </main>
    </>
  );
}
