import { Wordmark } from '@vendra/ui';
import Link from 'next/link';
import { readCart } from '../lib/cart';
import { listCategories } from '../lib/catalogue';
import { session } from '../lib/session';

export async function SiteHeader({ query }: { query?: string }) {
  const [profile, categories, cart] = await Promise.all([session.getProfile(), listCategories(), readCart()]);
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
        <div className="ml-auto flex items-center gap-4 sm:ml-0">
          <Link href={profile ? '/account' : '/login'} className="text-sm font-semibold text-primary">
            {profile ? 'My account' : 'Sign in'}
          </Link>
          <Link href="/cart" className="relative text-sm font-semibold text-primary" aria-label={`Basket, ${cart.itemCount} ${cart.itemCount === 1 ? 'item' : 'items'}`}>
            Basket
            {cart.itemCount > 0 ? (
              <span aria-hidden="true" className="ml-1 inline-grid min-w-5 place-items-center rounded-full bg-accent px-1.5 text-xs font-bold text-accent-foreground">
                {cart.itemCount}
              </span>
            ) : null}
          </Link>
        </div>
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
