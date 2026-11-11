import { ActionForm, Alert, Card, Field, Input, Select, SubmitButton } from '@vendra/ui';
import { formatMoney } from '@vendra/utils';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { SiteHeader } from '../../components/site-header';
import { readCart } from '../../lib/cart';
import { session } from '../../lib/session';
import { STATES } from '../../lib/states';
import { checkDelivery, startCheckout } from './actions';

export const metadata: Metadata = { title: 'Checkout · Vendra', robots: { index: false } };


export default async function CheckoutPage() {
  await session.requireProfile();
  const [cart, last] = await Promise.all([readCart(), session.read((api) => api.GET('/v1/store/checkout/last-address'))]);
  if (!cart.canCheckout) redirect('/cart');
  const address = last.address;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <p className="text-sm">
          <Link href="/cart" className="text-muted underline">
            Back to basket
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Checkout</h1>
        <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_18rem]">
          <Card>
            <h2 className="mb-4 font-semibold">Delivery address</h2>
            <ActionForm action={startCheckout} className="grid gap-4 sm:grid-cols-2">
              {/* One key per page view: a double submit or a retry holds stock only once. */}
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <Field label="Full name of recipient" className="sm:col-span-2">
                <Input name="recipient" autoComplete="name" defaultValue={address?.recipient} required minLength={2} maxLength={100} />
              </Field>
              <Field label="Phone number" hint="The rider calls this number on delivery." className="sm:col-span-2">
                <Input name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={address?.phone.replace(/^\+234/, '0')} placeholder="0803 123 4567" required />
              </Field>
              <Field label="Street address" className="sm:col-span-2">
                <Input name="line1" autoComplete="address-line1" defaultValue={address?.line1} required minLength={3} maxLength={200} />
              </Field>
              <Field label="Landmark or apartment (optional)" className="sm:col-span-2">
                <Input name="line2" autoComplete="address-line2" defaultValue={address?.line2 ?? ''} maxLength={200} />
              </Field>
              <Field label="City or town">
                <Input name="city" autoComplete="address-level2" defaultValue={address?.city} required minLength={2} maxLength={100} />
              </Field>
              <Field label="State">
                <Select name="state" autoComplete="address-level1" defaultValue={address?.state ?? ''} required>
                  <option value="" disabled>
                    Choose a state
                  </option>
                  {STATES.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="sm:col-span-2">
                <SubmitButton size="lg" className="w-full" pendingLabel="Holding your items…">
                  Continue to payment
                </SubmitButton>
                <p className="mt-2 text-xs text-muted">We hold your items for 15 minutes while you pay. You see the full total, including delivery, before paying.</p>
              </div>
            </ActionForm>
          </Card>

          <div className="space-y-4">
            <Card>
              <h2 className="mb-3 font-semibold">Order summary</h2>
              <ul className="space-y-2 text-sm">
                {cart.lines.map((line) => (
                  <li key={line.listingId} className="flex justify-between gap-3">
                    <span className="min-w-0">
                      {line.quantity} × {line.productName}
                    </span>
                    <span className="tabular-nums">{line.lineTotal ? formatMoney(line.lineTotal.amountMinor, line.lineTotal.currency) : ''}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex justify-between border-t border-border pt-3 text-sm font-semibold">
                <span>Items</span>
                <span className="tabular-nums">{formatMoney(cart.subtotal.amountMinor, cart.subtotal.currency)}</span>
              </div>
            </Card>
            <Card>
              <h2 className="mb-3 text-sm font-semibold">Check the delivery fee</h2>
              <ActionForm action={checkDelivery} className="flex items-end gap-2">
                <Field label="State" className="flex-1">
                  <Select name="state" defaultValue={address?.state ?? 'Lagos'}>
                    {STATES.map((state) => (
                      <option key={state} value={state}>
                        {state}
                      </option>
                    ))}
                  </Select>
                </Field>
                <SubmitButton size="sm" variant="outline" pendingLabel="…">
                  Check
                </SubmitButton>
              </ActionForm>
            </Card>
            <Alert tone="warning">Pay only on Vendra. Our riders never ask for payment at the door.</Alert>
          </div>
        </div>
      </main>
    </>
  );
}
