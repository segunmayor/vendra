import { Badge, cn } from '@vendra/ui';
import { formatMoney } from '@vendra/utils';
import Link from 'next/link';
import type { Availability, ProductCard as Card } from '../lib/catalogue';

type Money = Card['priceFrom'];

export function Price({ from, to, className }: { from: Money; to: Money; className?: string }) {
  const same = from.amountMinor === to.amountMinor;
  return (
    <span className={cn('font-bold tabular-nums', className)}>
      {same ? formatMoney(from.amountMinor, from.currency) : <>From {formatMoney(from.amountMinor, from.currency)}</>}
    </span>
  );
}

const AVAILABILITY: Record<Availability, { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  in_stock: { label: 'In stock', tone: 'success' },
  low_stock: { label: 'Few left', tone: 'warning' },
  out_of_stock: { label: 'Out of stock', tone: 'neutral' },
};

export function AvailabilityBadge({ availability, quantity }: { availability: Availability; quantity?: number | null }) {
  const { label, tone } = AVAILABILITY[availability];
  return <Badge tone={tone}>{availability === 'low_stock' && quantity ? `Only ${quantity} left` : label}</Badge>;
}

/** A product image, or a branded tile until photos are uploaded. Fixed aspect ratio, so nothing shifts as it loads. */
export function ProductImage({ src, name, className }: { src: string | null; name: string; className?: string }) {
  if (src) {
    // A plain img until image hosting is chosen; next/image needs an allowed host.
    return <img src={src} alt={name} loading="lazy" className={cn('aspect-square w-full rounded-brand object-cover', className)} />;
  }
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <div
      aria-hidden="true"
      className={cn('grid aspect-square w-full place-items-center rounded-brand bg-[#e9ebf5] text-3xl font-extrabold text-primary/70', className)}
    >
      {initials}
    </div>
  );
}

export function ProductCard({ product }: { product: Card }) {
  return (
    <li className="group">
      <Link href={`/p/${product.slug}`} className="block rounded-brand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
        <ProductImage src={product.image ?? null} name={product.name} className="transition-opacity group-hover:opacity-90" />
        <div className="mt-3 space-y-1">
          {product.brand ? <div className="text-xs font-medium tracking-wide text-muted uppercase">{product.brand.name}</div> : null}
          <h3 className="line-clamp-2 text-sm font-semibold group-hover:underline">{product.name}</h3>
          <Price from={product.priceFrom} to={product.priceTo} className="block text-base" />
          {product.availability !== 'in_stock' ? <AvailabilityBadge availability={product.availability} /> : null}
        </div>
      </Link>
    </li>
  );
}

export function ProductGrid({ products, label }: { products: readonly Card[]; label: string }) {
  return (
    <ul aria-label={label} className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </ul>
  );
}
