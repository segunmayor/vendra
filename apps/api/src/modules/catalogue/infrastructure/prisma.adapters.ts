import { Prisma, type PrismaClient } from '@prisma/client';
import { appendAudit } from '../../../platform/audit/audit';
import { appendToOutbox } from '../../../platform/outbox/outbox';
import { ApplicationError, AuditEntry, ConcurrencyConflict } from '../../../shared-kernel';
import { VariantSummary } from '../application/catalogue.queries';
import { BrandRepository, BrandView, CategoryRepository, CategoryView, ProductRepository, ProductSummary } from '../application/ports';
import { AttributeDefinition, AttributeValue } from '../domain/attributes';
import { Product, ProductStatus } from '../domain/product';

/** Maps a unique violation to a conflict, naming the field that clashed. */
function conflictOn(error: unknown, fields: Record<string, [string, string]>): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = String((error.meta as { target?: unknown } | undefined)?.target ?? '');
    for (const [field, [code, message]] of Object.entries(fields)) {
      if (target.includes(field)) throw new ApplicationError('conflict', code, message);
    }
    throw new ApplicationError('conflict', 'catalogue.duplicate', 'This value is already in use');
  }
  throw error;
}

const json = (value: unknown) => value as Prisma.InputJsonValue;

const toCategory = (row: { id: string; parentId: string | null; name: string; slug: string; attributeSchema: unknown }): CategoryView => ({
  id: row.id,
  parentId: row.parentId,
  name: row.name,
  slug: row.slug,
  attributes: (row.attributeSchema as AttributeDefinition[] | null) ?? [],
});

export class PrismaCategoryRepository implements CategoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<CategoryView[]> {
    return (await this.prisma.category.findMany({ orderBy: { name: 'asc' } })).map(toCategory);
  }

  async findById(id: string): Promise<CategoryView | null> {
    const row = await this.prisma.category.findUnique({ where: { id } });
    return row ? toCategory(row) : null;
  }

  async create(category: CategoryView, audit: AuditEntry): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.category.create({
          data: {
            id: category.id,
            parentId: category.parentId,
            name: category.name,
            slug: category.slug,
            attributeSchema: json(category.attributes),
          },
        });
        await appendAudit(tx, audit);
      });
    } catch (error) {
      conflictOn(error, { slug: ['category.slug_taken', 'A category already uses this web address'] });
    }
  }

  async update(category: CategoryView, audit: AuditEntry): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.category.update({
        where: { id: category.id },
        data: { name: category.name, attributeSchema: json(category.attributes) },
      });
      await appendAudit(tx, audit);
    });
  }
}

export class PrismaBrandRepository implements BrandRepository {
  constructor(private readonly prisma: PrismaClient) {}

  list(): Promise<BrandView[]> {
    return this.prisma.brand.findMany({ orderBy: { name: 'asc' } });
  }

  findById(id: string): Promise<BrandView | null> {
    return this.prisma.brand.findUnique({ where: { id } });
  }

  async create(brand: BrandView, audit: AuditEntry): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.brand.create({ data: brand });
        await appendAudit(tx, audit);
      });
    } catch (error) {
      conflictOn(error, {
        name: ['brand.name_taken', 'This brand already exists'],
        slug: ['brand.name_taken', 'This brand already exists'],
      });
    }
  }
}

const productInclude = { variants: { orderBy: { sku: 'asc' } } } as const;
type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

const toProduct = (row: ProductRow): Product =>
  Product.rehydrate({
    id: row.id,
    categoryId: row.categoryId,
    brandId: row.brandId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    attributes: row.attributes as Record<string, AttributeValue>,
    status: row.status as ProductStatus,
    version: row.version,
    variants: row.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      weightGrams: variant.weightGrams,
      options: variant.options as Record<string, string>,
    })),
  });

export class PrismaProductRepository implements ProductRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Product | null> {
    const row = await this.prisma.product.findUnique({ where: { id }, include: productInclude });
    return row ? toProduct(row) : null;
  }

  async findVariant(id: string): Promise<VariantSummary | null> {
    const row = await this.prisma.productVariant.findUnique({
      where: { id },
      include: { product: { select: { id: true, name: true, status: true } } },
    });
    if (!row) return null;
    return {
      variantId: row.id,
      sku: row.sku,
      productId: row.product.id,
      productName: row.product.name,
      productStatus: row.product.status as ProductStatus,
    };
  }

  async list(query: { limit: number; cursor?: string; status?: ProductStatus }): Promise<ProductSummary[]> {
    const rows = await this.prisma.product.findMany({
      where: query.status ? { status: query.status } : {},
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { _count: { select: { variants: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status as ProductStatus,
      categoryId: row.categoryId,
      brandId: row.brandId,
      variantCount: row._count.variants,
      updatedAt: row.updatedAt,
    }));
  }

  async save(product: Product, audit: AuditEntry): Promise<void> {
    const state = product.snapshot;
    const events = product.pullEvents();
    const fields = {
      name: state.name,
      description: state.description,
      brandId: state.brandId,
      attributes: json(state.attributes),
      status: state.status,
    };
    const variantRows = state.variants.map((variant) => ({
      id: variant.id,
      productId: state.id,
      sku: variant.sku,
      weightGrams: variant.weightGrams,
      options: json(variant.options),
    }));
    try {
      await this.prisma.$transaction(async (tx) => {
        if (state.version === 0) {
          await tx.product.create({
            data: { ...fields, id: state.id, categoryId: state.categoryId, slug: state.slug, version: 1 },
          });
        } else {
          const { count } = await tx.product.updateMany({
            where: { id: state.id, version: state.version },
            data: { ...fields, version: { increment: 1 } },
          });
          if (count !== 1) throw new ConcurrencyConflict('Product', state.id);
        }
        // Variants are only ever added, so insert those the database does not have.
        const saved = new Set(
          (await tx.productVariant.findMany({ where: { productId: state.id }, select: { id: true } })).map((v) => v.id),
        );
        const added = variantRows.filter((variant) => !saved.has(variant.id));
        if (added.length > 0) await tx.productVariant.createMany({ data: added });
        await appendAudit(tx, audit);
        await appendToOutbox(tx, events);
      });
    } catch (error) {
      conflictOn(error, {
        sku: ['variant.sku_taken', 'Another product already uses this SKU'],
        slug: ['product.slug_taken', 'Another product already uses this web address'],
      });
    }
    product.markSaved();
  }
}
