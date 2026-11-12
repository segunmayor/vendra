import { ActionForm, buttonVariants, Card, EmptyState, SubmitButton } from '@vendra/ui';
import { formatMoney } from '@vendra/utils';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ProductImage } from '../../components/catalogue';
import { SiteHeader } from '../../components/site-header';
import { type CartLine, readCart } from '../../lib/cart';
import { updateItem } from './actions';

export const metadata: Metadata = { title: 'Your basket', robots: { index: false } };

function issueText(line: CartLine): string | null {
  switch (line.issue) {
    case 'unavailable':
      return 'No longer on sale. Remove it to continue.';
    case 'out_of_stock':
      return 'Out of stock. Remove it to continue.';
    case 'insufficient_stock':
      return `Only ${line.availableQuantity} available. Lower the quantity to continue.`;
    default:
      return null;
  }
}

export default async function CartPage() {
  const cart = await readCart();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">Your basket</h1>
        {cart.lines.length === 0 ? (
          <div className="mt-6">
            <EmptyState title="Your basket is empty">
              <Link href="/products" className="font-semibold text-primary underline">
                Start shopping
              </Link>
            </EmptyState>
          </div>
        ) : (
          <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_18rem]">
            <ul className="space-y-4" aria-label="Items in your basket">
              {cart.lines.map((line) => {
                const problem = issueText(line);
                const options = Object.values(line.options).join(' · ');
                return (
                  <li key={line.listingId}>
                    <Card className={`flex gap-4 ${problem ? 'border-[#f1d9a0]' : ''}`}>
                      <div className="w-20 shrink-0">
                        <ProductImage src={line.image ?? null} name={line.productName} />
                      </div>
                      <div className="min-w-0 flex-1">
                        {line.productSlug ? (
                          <Link href={`/p/${line.productSlug}`} className="font-semibold hover:underline">
                            {line.productName}
                          </Link>
                        ) : (
                          <span className="font-semibold">{line.productName}</span>
                        )}
                        {options ? <div className="text-sm text-muted">{options}</div> : null}
                        {line.unitPrice ? (
                          <div className="mt-1 text-sm">{formatMoney(line.unitPrice.amountMinor, line.unitPrice.currency)} each</div>
                        ) : null}
                        {problem ? <p className="mt-2 text-sm font-medium text-[#7a5200]">{problem}</p> : null}
                        <div className="mt-3 flex flex-wrap items-end gap-3">
                          <ActionForm action={updateItem} className="flex items-end gap-2">
                            <input type="hidden" name="listingId" value={line.listingId} />
                            <label className="text-sm">
                              <span className="sr-only">Quantity of {line.productName}</span>
                              <select name="quantity" defaultValue={line.quantity} className="h-10 rounded-brand border border-border bg-surface px-2">
                                {Array.from({ length: 11 }, (_, value) => (
                                  <option key={value} value={value}>
                                    {value === 0 ? 'Remove' : value}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <SubmitButton size="sm" variant="outline" pendingLabel="…">
                              Update
                            </SubmitButton>
                          </ActionForm>
                          <ActionForm action={updateItem}>
                            <input type="hidden" name="listingId" value={line.listingId} />
                            <input type="hidden" name="quantity" value="0" />
                            <SubmitButton size="sm" variant="outline" pendingLabel="…">
                              Remove
                            </SubmitButton>
                          </ActionForm>
                        </div>
                      </div>
                      <div className="text-right font-semibold tabular-nums">
                        {line.lineTotal ? formatMoney(line.lineTotal.amountMinor, line.lineTotal.currency) : '—'}
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
            <Card className="h-fit">
              <div className="flex justify-between text-sm">
                <span>Items ({cart.itemCount})</span>
                <span className="font-semibold tabular-nums">{formatMoney(cart.subtotal.amountMinor, cart.subtotal.currency)}</span>
              </div>
              <p className="mt-2 text-xs text-muted">Delivery is added at checkout, based on your address.</p>
              {cart.canCheckout ? (
                <Link href="/checkout" className={buttonVariants({ size: 'lg', className: 'mt-4 w-full' })}>
                  Checkout
                </Link>
              ) : (
                <p className="mt-4 rounded-brand bg-background px-3 py-2 text-sm">Fix the items marked above to continue.</p>
              )}
            </Card>
          </div>
        )}
      </main>
    </>
  );
}
