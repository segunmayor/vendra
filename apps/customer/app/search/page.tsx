import type { Metadata } from 'next';
import { ProductResults } from '../../components/product-results';
import { SiteHeader } from '../../components/site-header';

export async function generateMetadata({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }): Promise<Metadata> {
  const { q } = await searchParams;
  // Search result pages are thin, duplicate content, so keep them out of search engines.
  return { title: q ? `“${q.slice(0, 60)}” · Vendra` : 'Search · Vendra', robots: { index: false, follow: true } };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const q = params.q?.trim().slice(0, 100) || undefined;
  return (
    <>
      <SiteHeader query={q} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        {q ? (
          <>
            <h1 className="mb-6 text-2xl font-bold tracking-tight">
              Results for “<span className="break-all">{q}</span>”
            </h1>
            <ProductResults
              query={{ q, cursor: params.cursor }}
              path="/search"
              label={`Results for ${q}`}
              empty={{ title: 'No matching products', body: 'Check the spelling, or try a shorter or more general word.' }}
            />
          </>
        ) : (
          <h1 className="text-2xl font-bold tracking-tight">What are you looking for?</h1>
        )}
      </main>
    </>
  );
}
