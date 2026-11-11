import Link from 'next/link';
import { SiteHeader } from '../components/site-header';

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-xl px-4 py-20 text-center">
        <h1 className="text-2xl font-bold">We could not find that page</h1>
        <p className="mt-2 text-muted">The product may no longer be on sale, or the link may be wrong.</p>
        <Link href="/products" className="mt-6 inline-block font-semibold text-primary underline">
          Browse all products
        </Link>
      </main>
    </>
  );
}
