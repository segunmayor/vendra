import { Prisma, type PrismaClient } from '@prisma/client';
import type { NamedRef, ProductSearch, PublishedProduct, SearchFilter, SearchPosition } from '../application/storefront';
import type { AttributeValue } from '../domain/attributes';
import type { SettingsReader } from '../../settings';


interface Row {
  id: string;
  slug: string;
  name: string;
  images: unknown;
  createdAt: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  brandId: string | null;
  brandName: string | null;
  brandSlug: string | null;
}

const columns = Prisma.sql`
  p."id", p."slug", p."name", p."images", p."createdAt"::text AS "createdAt",
  c."id" AS "categoryId", c."name" AS "categoryName", c."slug" AS "categorySlug",
  b."id" AS "brandId", b."name" AS "brandName", b."slug" AS "brandSlug"`;

const joins = Prisma.sql`
  FROM "catalogue"."products" p
  JOIN "catalogue"."categories" c ON c."id" = p."categoryId"
  LEFT JOIN "catalogue"."brands" b ON b."id" = p."brandId"`;

function filters(filter: SearchFilter): Prisma.Sql {
  const parts = [Prisma.sql`p."status" = 'published'`];
  if (filter.categoryIds) parts.push(Prisma.sql`p."categoryId" = ANY(${[...filter.categoryIds]}::uuid[])`);
  if (filter.brandId) parts.push(Prisma.sql`p."brandId" = ${filter.brandId}::uuid`);
  return Prisma.join(parts, ' AND ');
}

const images = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);

/** PostgreSQL full-text search with trigram typo tolerance. Owns only catalogue tables. */
export class PostgresProductSearch implements ProductSearch {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly settings: SettingsReader,
  ) {}

  async search(filter: SearchFilter, after: SearchPosition | null, limit: number) {
    const rows = filter.text ? await this.byRelevance(filter, after, limit) : await this.byNewest(filter, after, limit);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const variants = await this.variantsOf(page.map((row) => row.id));
    const start = after?.kind === 'rank' ? after.offset : 0;
    return {
      hasMore,
      items: page.map((row, index) => ({
        product: this.toProduct(row, variants),
        position: (filter.text
          ? { kind: 'rank', offset: start + index + 1 }
          : { kind: 'newest', createdAt: row.createdAt, id: row.id }) satisfies SearchPosition,
      })),
    };
  }

  private async byRelevance(filter: SearchFilter, after: SearchPosition | null, limit: number): Promise<Row[]> {
    const text = filter.text!;
    const offset = after?.kind === 'rank' ? after.offset : 0;
    // A typo matches when this share of its trigrams appear in a word of the name (setting
    // search.typoTolerance, 0.3 to 0.9). set_config with is_local = true lasts for the transaction.
    const threshold = await this.settings.get('search.typoTolerance');
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(threshold)}, true)`;
      return tx.$queryRaw<Row[]>`
        WITH q AS (
          SELECT websearch_to_tsquery('english', catalogue.search_text(${text})) AS query,
                 catalogue.search_text(${text}) AS plain
        )
        SELECT ${columns},
          ts_rank(p."searchVector", q.query) * 2
            + word_similarity(q.plain, catalogue.search_text(p."name"))
            + CASE WHEN b."name" IS NOT NULL AND q.plain <% catalogue.search_text(b."name") THEN 0.5 ELSE 0 END AS score
        ${joins}
        CROSS JOIN q
        WHERE ${filters(filter)}
          AND (
            p."searchVector" @@ q.query
            OR q.plain <% catalogue.search_text(p."name")
            OR (b."name" IS NOT NULL AND q.plain <% catalogue.search_text(b."name"))
            OR to_tsvector('english', catalogue.search_text(c."name")) @@ q.query
          )
        ORDER BY score DESC, p."id"
        OFFSET ${offset} LIMIT ${limit + 1}`;
    });
  }

  private byNewest(filter: SearchFilter, after: SearchPosition | null, limit: number): Promise<Row[]> {
    const keyset =
      after?.kind === 'newest'
        ? Prisma.sql`AND (p."createdAt", p."id") < (${after.createdAt}::timestamptz, ${after.id}::uuid)`
        : Prisma.empty;
    return this.prisma.$queryRaw<Row[]>`
      SELECT ${columns}
      ${joins}
      WHERE ${filters(filter)} ${keyset}
      ORDER BY p."createdAt" DESC, p."id" DESC
      LIMIT ${limit + 1}`;
  }

  private async variantsOf(productIds: readonly string[]) {
    if (productIds.length === 0) return new Map<string, PublishedProduct['variants']>();
    const rows = await this.prisma.productVariant.findMany({
      where: { productId: { in: [...productIds] } },
      orderBy: [{ position: 'asc' }, { sku: 'asc' }],
      select: { id: true, sku: true, options: true, productId: true },
    });
    const byProduct = new Map<string, { id: string; sku: string; options: Record<string, string> }[]>();
    for (const row of rows) {
      const list = byProduct.get(row.productId) ?? [];
      list.push({ id: row.id, sku: row.sku, options: row.options as Record<string, string> });
      byProduct.set(row.productId, list);
    }
    return byProduct;
  }

  private toProduct(row: Row, variants: Map<string, PublishedProduct['variants']>): PublishedProduct {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      images: images(row.images),
      category: { id: row.categoryId, name: row.categoryName, slug: row.categorySlug },
      brand: row.brandId ? { id: row.brandId, name: row.brandName!, slug: row.brandSlug! } : null,
      variants: variants.get(row.id) ?? [],
    };
  }

  async findPublishedBySlug(slug: string) {
    const row = await this.prisma.product.findFirst({
      where: { slug, status: 'published' },
      include: { category: true, brand: true, variants: { orderBy: [{ position: 'asc' }, { sku: 'asc' }] } },
    });
    if (!row) return null;
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      images: images(row.images),
      attributes: row.attributes as Record<string, AttributeValue>,
      category: { id: row.category.id, name: row.category.name, slug: row.category.slug },
      brand: row.brand ? { id: row.brand.id, name: row.brand.name, slug: row.brand.slug } : null,
      variants: row.variants.map((variant) => ({ id: variant.id, sku: variant.sku, options: variant.options as Record<string, string> })),
    };
  }

  async countPublishedByCategory(): Promise<Map<string, number>> {
    const rows = await this.prisma.product.groupBy({ by: ['categoryId'], where: { status: 'published' }, _count: { _all: true } });
    return new Map(rows.map((row) => [row.categoryId, row._count._all]));
  }

  async findBrandBySlug(slug: string): Promise<NamedRef | null> {
    return this.prisma.brand.findUnique({ where: { slug }, select: { id: true, name: true, slug: true } });
  }
}
