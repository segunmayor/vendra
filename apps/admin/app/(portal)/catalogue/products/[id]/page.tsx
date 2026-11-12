import { ActionForm, Alert, Badge, Card, Field, Input, PageHeader, Select, SubmitButton, Table, Td, Textarea } from '@vendra/ui';
import { formatMoney } from '@vendra/utils';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { isUuid, LISTING_TONE, STATUS_TONE } from '../../../../../lib/catalogue';
import { can, session } from '../../../../../lib/session';
import {
  addVariant,
  adjustStock,
  archiveProduct,
  createListing,
  publishProduct,
  setListingActive,
  setListingPrice,
  updateProduct,
} from '../actions';
import { AttributeFields } from '../attribute-fields';

export const metadata: Metadata = { title: 'Product' };

const REASONS = [
  { value: 'receipt', label: 'Received from supplier' },
  { value: 'returned', label: 'Returned by customer' },
  { value: 'correction', label: 'Stock count correction' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'lost', label: 'Lost' },
] as const;

/** Shows naira without the kobo when there are none, for the price input. */
const nairaInput = (minor: string) => (minor.endsWith('00') ? minor.slice(0, -2) || '0' : `${minor.slice(0, -2) || '0'}.${minor.slice(-2)}`);

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const inventory = await can('inventory.manage');

  const [product, categories, brands, listings, stock, warehouses] = await Promise.all([
    session.find((api) => api.GET('/v1/admin/products/{id}', { params: { path: { id } } })),
    session.read((api) => api.GET('/v1/admin/categories')),
    session.read((api) => api.GET('/v1/admin/brands')),
    session.find((api) => api.GET('/v1/admin/listings', { params: { query: { productId: id } } })).then((rows) => rows ?? []),
    inventory
      ? session.find((api) => api.GET('/v1/admin/stock', { params: { query: { productId: id } } })).then((rows) => rows ?? [])
      : Promise.resolve([]),
    inventory ? session.read((api) => api.GET('/v1/admin/warehouses')) : Promise.resolve([]),
  ]);
  if (!product) notFound();
  const category = categories.find((entry) => entry.id === product.categoryId);
  const listingFor = new Map(listings.map((listing) => [listing.variantId, listing]));
  const warehouseName = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.name]));
  const activeWhileArchived = product.status === 'archived' && listings.some((listing) => listing.status === 'active');

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/catalogue/products" className="text-muted underline underline-offset-2">
          Products
        </Link>
      </p>
      <PageHeader
        title={product.name}
        description={
          <>
            <Badge tone={STATUS_TONE[product.status]}>{product.status}</Badge> <span className="ml-1">{category?.name}</span>
            <span className="ml-1">· /{product.slug}</span>
          </>
        }
        actions={
          <>
            {product.status !== 'published' ? (
              <ActionForm action={publishProduct.bind(null, product.id)}>
                <SubmitButton size="sm" pendingLabel="Publishing…">
                  Publish
                </SubmitButton>
              </ActionForm>
            ) : null}
            {product.status !== 'archived' ? (
              <ActionForm action={archiveProduct.bind(null, product.id)}>
                <SubmitButton size="sm" variant="outline" pendingLabel="Archiving…">
                  Archive
                </SubmitButton>
              </ActionForm>
            ) : null}
          </>
        }
      />

      {activeWhileArchived ? (
        <div className="mb-6">
          <Alert tone="warning">This product is archived but still has a listing on sale. Take each listing off sale below.</Alert>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section aria-labelledby="variants" className="space-y-4">
          <h2 id="variants" className="text-lg font-semibold">
            Variants, prices and stock
          </h2>
          {product.variants.length === 0 ? (
            <Alert tone="warning">Add at least one variant before publishing.</Alert>
          ) : null}
          {product.variants.map((variant) => {
            const listing = listingFor.get(variant.id);
            const rows = listing ? stock.filter((entry) => entry.listingId === listing.id) : [];
            const options = Object.entries(variant.options);
            return (
              <Card key={variant.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold">
                    SKU {variant.sku}
                    {options.length > 0 ? (
                      <span className="ml-2 font-normal text-muted">{options.map(([name, value]) => `${name}: ${value}`).join(' · ')}</span>
                    ) : null}
                  </h3>
                  <span className="text-sm text-muted">{variant.weightGrams.toLocaleString('en-NG')} g packed</span>
                </div>

                {listing ? (
                  <div className="mt-4 flex flex-wrap items-end gap-4 border-t border-border pt-4">
                    <div>
                      <div className="text-xs text-muted">Price</div>
                      <div className="text-lg font-semibold">{formatMoney(listing.price.amountMinor, listing.price.currency)}</div>
                    </div>
                    <Badge tone={LISTING_TONE[listing.status]}>{listing.status === 'active' ? 'on sale' : listing.status}</Badge>
                    <ActionForm action={setListingPrice.bind(null, product.id, listing.id)} className="flex items-end gap-2">
                      <Field label="New price (₦)">
                        <Input name="price" inputMode="decimal" defaultValue={nairaInput(listing.price.amountMinor)} className="w-36" required />
                      </Field>
                      <SubmitButton size="sm" variant="outline">
                        Update price
                      </SubmitButton>
                    </ActionForm>
                    <ActionForm action={setListingActive.bind(null, product.id, listing.id, listing.status !== 'active')}>
                      <SubmitButton size="sm" variant={listing.status === 'active' ? 'outline' : 'primary'}>
                        {listing.status === 'active' ? 'Take off sale' : 'Put on sale'}
                      </SubmitButton>
                    </ActionForm>
                  </div>
                ) : (
                  <ActionForm action={createListing.bind(null, product.id, variant.id)} className="mt-4 flex items-end gap-2 border-t border-border pt-4">
                    <Field label="Price (₦)">
                      <Input name="price" inputMode="decimal" placeholder="15,000" className="w-36" required />
                    </Field>
                    <SubmitButton size="sm">Set price</SubmitButton>
                  </ActionForm>
                )}

                {listing && inventory ? (
                  <div className="mt-4 border-t border-border pt-4">
                    {rows.length > 0 ? (
                      <Table caption={`Stock for SKU ${variant.sku}`} head={['Warehouse', 'On hand', 'Reserved', 'Available']}>
                        {rows.map((row) => (
                          <tr key={row.warehouseId}>
                            <Td>{warehouseName.get(row.warehouseId) ?? 'Unknown warehouse'}</Td>
                            <Td>{row.onHand}</Td>
                            <Td>{row.reserved}</Td>
                            <Td className="font-semibold">{row.available}</Td>
                          </tr>
                        ))}
                      </Table>
                    ) : (
                      <p className="text-sm text-muted">No stock recorded yet.</p>
                    )}
                    {warehouses.length === 0 ? (
                      <p className="mt-3 text-sm">
                        <Link href="/inventory/warehouses" className="underline">
                          Add a warehouse
                        </Link>{' '}
                        to record stock.
                      </p>
                    ) : (
                      <ActionForm action={adjustStock.bind(null, product.id, listing.id)} className="mt-3 grid gap-3 sm:grid-cols-5 sm:items-end">
                        <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                        <Field label="Warehouse">
                          <Select name="warehouseId" defaultValue={warehouses[0]?.id} required>
                            {warehouses.map((warehouse) => (
                              <option key={warehouse.id} value={warehouse.id}>
                                {warehouse.name}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Change">
                          <Select name="direction" defaultValue="add">
                            <option value="add">Add</option>
                            <option value="remove">Remove</option>
                          </Select>
                        </Field>
                        <Field label="Units">
                          <Input name="quantity" type="number" min={1} step={1} required />
                        </Field>
                        <Field label="Reason">
                          <Select name="reason" defaultValue="receipt">
                            {REASONS.map((reason) => (
                              <option key={reason.value} value={reason.value}>
                                {reason.label}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <SubmitButton size="sm" variant="outline">
                          Record
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </div>
                ) : null}
              </Card>
            );
          })}

          <Card>
            <h3 className="mb-3 font-semibold">Add a variant</h3>
            <ActionForm action={addVariant.bind(null, product.id)} className="grid gap-4 sm:grid-cols-2">
              <Field label="SKU" hint="Letters, digits, dots, dashes or underscores.">
                <Input name="sku" required minLength={2} maxLength={64} pattern="[A-Za-z0-9._\-]+" />
              </Field>
              <Field label="Packed weight (grams)" hint="Used to price delivery.">
                <Input name="weightGrams" type="number" min={1} max={1_000_000} step={1} required />
              </Field>
              <Field label="Options" hint='One per line, such as "Size: M". Leave blank if there is only one version.' className="sm:col-span-2">
                <Textarea name="options" rows={3} placeholder={'Colour: Indigo\nSize: M'} />
              </Field>
              <div className="sm:col-span-2">
                <SubmitButton variant="outline">Add variant</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        </section>

        <section aria-labelledby="details">
          <Card>
            <h2 id="details" className="mb-4 text-lg font-semibold">
              Details
            </h2>
            {product.status === 'published' ? (
              <p className="mb-4 text-sm text-muted">This product is live. Required details cannot be cleared.</p>
            ) : null}
            <ActionForm action={updateProduct.bind(null, product.id, product.categoryId)} className="space-y-4">
              <Field label="Name">
                <Input name="name" defaultValue={product.name} required minLength={2} maxLength={300} />
              </Field>
              <Field label="Brand">
                <Select name="brandId" defaultValue={product.brandId ?? ''}>
                  <option value="">No brand</option>
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Description">
                <Textarea name="description" defaultValue={product.description} rows={6} maxLength={10_000} />
              </Field>
              <AttributeFields definitions={category?.attributes ?? []} values={product.attributes} />
              <SubmitButton>Save details</SubmitButton>
            </ActionForm>
          </Card>
        </section>
      </div>
    </>
  );
}
