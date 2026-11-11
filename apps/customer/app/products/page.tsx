import type { Metadata } from 'next';
import { ProductResults } from '../../components/product-results';
import { SiteHeader } from '../../components/site-header';

export const metadata: Metadata = { title: 'All products · Vendra' };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { cursor } = await searchParams;
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold tracking-tight">All products</h1>
        <ProductResults
          query={{ cursor }}
          path="/products"
          label="Products"
          empty={{ title: 'Products are coming soon', body: 'The catalogue will appear here once products are on sale.' }}
        />
      </main>
    </>
  );
}
