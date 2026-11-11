import { Wordmark } from '@vendra/ui';
import Link from 'next/link';
import { listCategories } from '../lib/catalogue';
import { session } from '../lib/session';

export async function SiteHeader({ query }: { query?: string }) {
  const [profile, categories] = await Promise.all([session.getProfile(), listCategories()]);
  const top = categories.filter((category) => category.parentId === null);
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <Link href="/" aria-label="Vendra home">
          <Wordmark />
        </Link>
        <form action="/search" method="get" role="search" className="order-3 w-full sm:order-none sm:flex-1">
          <label className="sr-only" htmlFor="site-search">
            Search products
          </label>
          <input
            id="site-search"
            type="search"
            name="q"
            defaultValue={query}
            maxLength={100}
            placeholder="Search for phones, fabrics, appliances…"
            className="h-11 w-full rounded-full border border-border bg-background px-5 text-sm placeholder:text-muted focus-visible:outline-2 focus-visible:outline-primary"
          />
        </form>
        <Link href={profile ? '/account' : '/login'} className="ml-auto text-sm font-semibold text-primary sm:ml-0">
          {profile ? 'My account' : 'Sign in'}
        </Link>
      </div>
      {top.length > 0 ? (
        <nav aria-label="Categories" className="mx-auto flex max-w-6xl gap-5 overflow-x-auto px-4 pb-3 text-sm">
          <Link href="/products" className="whitespace-nowrap text-muted hover:text-foreground">
            All products
          </Link>
          {top.map((category) => (
            <Link key={category.id} href={`/c/${category.slug}`} className="whitespace-nowrap text-muted hover:text-foreground">
              {category.name}
            </Link>
          ))}
        </nav>
      ) : null}
    </header>
  );
}
