import { Badge, buttonVariants, EmptyState, PageHeader, Table, Td } from '@vendra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { isUuid, STATUS_TONE } from '../../../../lib/catalogue';
import { session } from '../../../../lib/session';

export const metadata: Metadata = { title: 'Products · Vendra Admin' };

const PAGE_SIZE = 50;
const STATUSES = ['draft', 'published', 'archived'] as const;
type Status = (typeof STATUSES)[number];

const dateTime = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' });

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const status = STATUSES.includes(params.status as Status) ? (params.status as Status) : undefined;
  const cursor = params.cursor && isUuid(params.cursor) ? params.cursor : undefined;

  const [products, categories, brands] = await Promise.all([
    session.read((api) => api.GET('/v1/admin/products', { params: { query: { limit: PAGE_SIZE, status, cursor } } })),
    session.read((api) => api.GET('/v1/admin/categories')),
    session.read((api) => api.GET('/v1/admin/brands')),
  ]);
  const categoryName = new Map(categories.map((category) => [category.id, category.name]));
  const brandName = new Map(brands.map((brand) => [brand.id, brand.name]));
  const last = products.at(-1);
  const query = (cursorId?: string) => {
    const search = new URLSearchParams();
    if (status) search.set('status', status);
    if (cursorId) search.set('cursor', cursorId);
    const value = search.toString();
    return value ? `?${value}` : '';
  };

  return (
    <>
      <PageHeader
        title="Products"
        description="Everything Vendra sells. A product goes on sale once it is published and has an active, stocked listing."
        actions={
          <Link href="/catalogue/products/new" className={buttonVariants({ size: 'sm' })}>
            Add product
          </Link>
        }
      />
      <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2 text-sm">
        {[undefined, ...STATUSES].map((option) => (
          <Link
            key={option ?? 'all'}
            href={`/catalogue/products${option ? `?status=${option}` : ''}`}
            aria-current={option === status ? 'page' : undefined}
            className={`rounded-full border px-3 py-1 capitalize ${option === status ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface'}`}
          >
            {option ?? 'All'}
          </Link>
        ))}
      </nav>

      {products.length === 0 ? (
        <EmptyState title={cursor ? 'No more products' : 'No products yet'}>
          {categories.length === 0 ? (
            <>
              Products belong to a category. <Link className="underline" href="/catalogue/categories">Create a category</Link> first.
            </>
          ) : (
            'Add the first product to start building the catalogue.'
          )}
        </EmptyState>
      ) : (
        <Table caption="Products" head={['Product', 'Category', 'Brand', 'Variants', 'Status', 'Updated']}>
          {products.map((product) => (
            <tr key={product.id}>
              <Td>
                <Link href={`/catalogue/products/${product.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                  {product.name}
                </Link>
                <div className="text-xs text-muted">{product.slug}</div>
              </Td>
              <Td>{categoryName.get(product.categoryId) ?? '—'}</Td>
              <Td>{product.brandId ? (brandName.get(product.brandId) ?? '—') : '—'}</Td>
              <Td>{product.variantCount}</Td>
              <Td>
                <Badge tone={STATUS_TONE[product.status]}>{product.status}</Badge>
              </Td>
              <Td className="whitespace-nowrap text-muted">{dateTime.format(new Date(product.updatedAt))}</Td>
            </tr>
          ))}
        </Table>
      )}

      <div className="mt-4 flex gap-3 text-sm">
        {cursor ? (
          <Link href={`/catalogue/products${query()}`} className="underline">
            First page
          </Link>
        ) : null}
        {last && products.length === PAGE_SIZE ? (
          <Link href={`/catalogue/products${query(last.id)}`} className="underline">
            Next page
          </Link>
        ) : null}
      </div>
    </>
  );
}
