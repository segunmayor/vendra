import { Card } from '@vendra/ui';
import { formatMoney } from '@vendra/utils';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AddToCart } from '../../../components/add-to-cart';
import { AvailabilityBadge, Price, ProductImage } from '../../../components/catalogue';
import { SiteHeader } from '../../../components/site-header';
import { getProduct, type ProductDetail } from '../../../lib/catalogue';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> };

const SCHEMA_AVAILABILITY = {
  in_stock: 'https://schema.org/InStock',
  low_stock: 'https://schema.org/LimitedAvailability',
  out_of_stock: 'https://schema.org/OutOfStock',
} as const;

const describe = (product: ProductDetail) =>
  (product.description || `${product.name} on Vendra`).replace(/\s+/g, ' ').trim().slice(0, 160);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await getProduct((await params).slug);
  if (!product) return { title: 'Not found · Vendra' };
  return {
    title: `${product.name} · Vendra`,
    description: describe(product),
    openGraph: { title: product.name, description: describe(product), images: product.images.slice(0, 1) },
  };
}

const naira = (amountMinor: string) => `${amountMinor.slice(0, -2) || '0'}.${amountMinor.slice(-2).padStart(2, '0')}`;

/** Lets search engines show price and stock. Built from API data and serialised safely for a script tag. */
function structuredData(product: ProductDetail) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: describe(product),
    ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand.name } } : {}),
    ...(product.images.length ? { image: product.images } : {}),
    offers: product.variants.map((variant) => ({
      '@type': 'Offer',
      sku: variant.sku,
      price: naira(variant.offer.price.amountMinor),
      priceCurrency: variant.offer.price.currency,
      availability: SCHEMA_AVAILABILITY[variant.offer.availability],
    })),
  };
  // Escaping "<" stops product text from closing the script element.
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export default async function ProductPage({ params, searchParams }: Props) {
  const product = await getProduct((await params).slug);
  if (!product) notFound();
  const { v } = await searchParams;
  const selected = product.variants.find((variant) => variant.sku === v) ?? product.variants[0]!;
  const hasChoices = product.variants.length > 1;
  const priceVaries = product.priceFrom.amountMinor !== product.priceTo.amountMinor;

  return (
    <>
      <SiteHeader />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData(product) }} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted">
          <ol className="flex flex-wrap gap-1">
            <li>
              <Link href="/" className="hover:underline">
                Home
              </Link>
            </li>
            {product.breadcrumb.map((entry) => (
              <li key={entry.id}>
                <span aria-hidden="true">/ </span>
                <Link href={`/c/${entry.slug}`} className="hover:underline">
                  {entry.name}
                </Link>
              </li>
            ))}
          </ol>
        </nav>

        <div className="grid gap-8 md:grid-cols-2 md:gap-12">
          <ProductImage src={product.images[0] ?? null} name={product.name} />

          <div>
            {product.brand ? <div className="text-sm font-medium tracking-wide text-muted uppercase">{product.brand.name}</div> : null}
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight md:text-3xl">{product.name}</h1>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="text-3xl font-bold tabular-nums">
                {formatMoney(selected.offer.price.amountMinor, selected.offer.price.currency)}
              </span>
              <AvailabilityBadge availability={selected.offer.availability} quantity={selected.offer.lowStockQuantity} />
            </div>
            {priceVaries ? (
              <p className="mt-1 text-sm text-muted">
                <Price from={product.priceFrom} to={product.priceTo} className="font-medium" /> across {product.variants.length} options
              </p>
            ) : null}

            {hasChoices ? (
              <fieldset className="mt-6">
                <legend className="mb-2 text-sm font-semibold">Choose an option</legend>
                <ul className="flex flex-wrap gap-2">
                  {product.variants.map((variant) => {
                    const label = Object.values(variant.options).join(' · ') || variant.sku;
                    const current = variant.id === selected.id;
                    return (
                      <li key={variant.id}>
                        <Link
                          href={`?v=${encodeURIComponent(variant.sku)}`}
                          scroll={false}
                          replace
                          aria-current={current ? 'true' : undefined}
                          className={`inline-block rounded-full border px-4 py-2 text-sm ${current ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface hover:border-primary'} ${variant.offer.availability === 'out_of_stock' ? 'line-through opacity-60' : ''}`}
                        >
                          {label}
                          {variant.offer.availability === 'out_of_stock' ? <span className="sr-only"> (out of stock)</span> : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            ) : null}

            <AddToCart
              listingId={selected.offer.listingId}
              max={selected.offer.lowStockQuantity ?? 10}
              disabled={selected.offer.availability === 'out_of_stock'}
            />

            <Card className="mt-6 text-sm">
              <p className="font-semibold">Pay securely, track your delivery</p>
              <p className="mt-1 text-muted">
                The delivery fee for your address is shown at checkout, before you pay. Payment is confirmed with your bank before we dispatch.
              </p>
            </Card>

            {product.description ? (
              <section className="mt-8">
                <h2 className="text-lg font-semibold">About this product</h2>
                <p className="mt-2 text-sm leading-relaxed whitespace-pre-line">{product.description}</p>
              </section>
            ) : null}

            {product.attributes.length > 0 ? (
              <section className="mt-8">
                <h2 className="text-lg font-semibold">Details</h2>
                <dl className="mt-2 divide-y divide-border rounded-brand border border-border bg-surface text-sm">
                  {product.attributes.map((attribute) => (
                    <div key={attribute.label} className="grid grid-cols-2 gap-4 px-4 py-2">
                      <dt className="text-muted">{attribute.label}</dt>
                      <dd>{attribute.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}
          </div>
        </div>
      </main>
    </>
  );
}
