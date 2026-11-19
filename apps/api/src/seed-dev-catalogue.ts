import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { CatalogueService } from './modules/catalogue/application/catalogue.service';
import { InventoryService } from './modules/inventory/application/inventory';
import { ListingService } from './modules/listings/application/listings';
import { PrismaService } from './platform/prisma/prisma.service';
import type { Principal } from './shared-kernel';

/**
 * Fills a local development database with test products sold by Vendra.
 * Refuses to run in production or against a database whose name lacks "dev".
 * Safe to run again: categories, brands and products that already exist are skipped.
 */

/** Recorded as the actor in audit entries, so seeded changes are easy to tell apart. */
const SEEDER: Principal = {
  accountId: '00000000-0000-4000-8000-0000000005ed',
  sessionId: '00000000-0000-4000-8000-0000000005ed',
  audience: 'admin',
  permissions: [],
};

interface SeedCategory { readonly name: string; readonly parent?: string; readonly attributes?: unknown[] }
interface SeedVariant { readonly sku: string; readonly options?: Record<string, string>; readonly grams: number; readonly naira: number; readonly stock: number }
interface SeedProduct {
  readonly name: string;
  readonly category: string;
  readonly brand?: string;
  readonly description: string;
  readonly attributes?: Record<string, unknown>;
  readonly variants: readonly SeedVariant[];
}

const CATEGORIES: readonly SeedCategory[] = [
  { name: 'Phones & Tablets' },
  {
    name: 'Smartphones',
    parent: 'Phones & Tablets',
    attributes: [{ key: 'screen_size', label: 'Screen size (inches)', type: 'number', required: true }],
  },
  { name: 'Phone Accessories', parent: 'Phones & Tablets' },
  { name: 'Computing' },
  { name: 'Electronics' },
  { name: 'Fashion' },
  { name: "Men's Fashion", parent: 'Fashion' },
  { name: "Women's Fashion", parent: 'Fashion' },
  { name: 'Home & Kitchen' },
  { name: 'Beauty & Health' },
  { name: 'Groceries' },
  { name: 'Baby Products' },
];

const BRANDS = ['Nova Mobile', 'Zenta', 'Kora Home', 'Adire House', 'Eko Naturals', 'Farmgate'];

const PRODUCTS: readonly SeedProduct[] = [
  {
    name: 'Nova X5 Smartphone',
    category: 'Smartphones',
    brand: 'Nova Mobile',
    description: 'Test product. 6.5 inch display, dual SIM, 5000 mAh battery.',
    attributes: { screen_size: 6.5 },
    variants: [
      { sku: 'TEST-NOVA-X5-128', options: { storage: '128 GB' }, grams: 450, naira: 185_000, stock: 25 },
      { sku: 'TEST-NOVA-X5-256', options: { storage: '256 GB' }, grams: 450, naira: 215_000, stock: 10 },
    ],
  },
  {
    name: 'Nova A2 Budget Phone',
    category: 'Smartphones',
    brand: 'Nova Mobile',
    description: 'Test product. 6.1 inch display, long battery life.',
    attributes: { screen_size: 6.1 },
    variants: [{ sku: 'TEST-NOVA-A2', grams: 400, naira: 79_500, stock: 3 }],
  },
  {
    name: 'Zenta 10 inch Tablet',
    category: 'Phones & Tablets',
    brand: 'Zenta',
    description: 'Test product. 10 inch tablet for reading and video.',
    variants: [{ sku: 'TEST-ZENTA-TAB10', options: { colour: 'Grey' }, grams: 700, naira: 120_000, stock: 8 }],
  },
  {
    name: 'Fast Charger 25W',
    category: 'Phone Accessories',
    brand: 'Zenta',
    description: 'Test product. USB-C wall charger.',
    variants: [{ sku: 'TEST-CHARGER-25W', grams: 120, naira: 8_500, stock: 60 }],
  },
  {
    name: 'Clear Phone Case',
    category: 'Phone Accessories',
    description: 'Test product. Slim transparent case.',
    variants: [{ sku: 'TEST-CASE-CLEAR', grams: 50, naira: 3_000, stock: 0 }],
  },
  {
    name: 'Zenta Book 14 Laptop',
    category: 'Computing',
    brand: 'Zenta',
    description: 'Test product. 14 inch laptop, 8 GB RAM, 512 GB SSD.',
    variants: [
      { sku: 'TEST-ZBOOK14-8', options: { memory: '8 GB' }, grams: 1600, naira: 450_000, stock: 5 },
      { sku: 'TEST-ZBOOK14-16', options: { memory: '16 GB' }, grams: 1600, naira: 540_000, stock: 2 },
    ],
  },
  {
    name: 'Wireless Mouse',
    category: 'Computing',
    brand: 'Zenta',
    description: 'Test product. Silent clicks, USB receiver.',
    variants: [{ sku: 'TEST-MOUSE-WL', grams: 100, naira: 6_500, stock: 40 }],
  },
  {
    name: '32 inch LED TV',
    category: 'Electronics',
    brand: 'Zenta',
    description: 'Test product. HD ready television.',
    variants: [{ sku: 'TEST-TV-32', grams: 6500, naira: 135_000, stock: 6 }],
  },
  {
    name: 'Bluetooth Speaker',
    category: 'Electronics',
    brand: 'Nova Mobile',
    description: 'Test product. Portable, water resistant.',
    variants: [{ sku: 'TEST-SPEAKER-BT', grams: 600, naira: 22_000, stock: 15 }],
  },
  {
    name: 'Ankara Print Shirt',
    category: "Men's Fashion",
    brand: 'Adire House',
    description: 'Test product. Short sleeve cotton shirt.',
    variants: [
      { sku: 'TEST-ANKARA-SHIRT-M', options: { size: 'M' }, grams: 250, naira: 12_000, stock: 12 },
      { sku: 'TEST-ANKARA-SHIRT-L', options: { size: 'L' }, grams: 260, naira: 12_000, stock: 12 },
      { sku: 'TEST-ANKARA-SHIRT-XL', options: { size: 'XL' }, grams: 270, naira: 13_000, stock: 4 },
    ],
  },
  {
    name: 'Leather Sandals',
    category: "Men's Fashion",
    brand: 'Adire House',
    description: 'Test product. Handmade leather sandals.',
    variants: [
      { sku: 'TEST-SANDAL-42', options: { size: '42' }, grams: 700, naira: 18_500, stock: 7 },
      { sku: 'TEST-SANDAL-44', options: { size: '44' }, grams: 720, naira: 18_500, stock: 0 },
    ],
  },
  {
    name: 'Adire Maxi Dress',
    category: "Women's Fashion",
    brand: 'Adire House',
    description: 'Test product. Hand dyed adire maxi dress.',
    variants: [
      { sku: 'TEST-ADIRE-DRESS-S', options: { size: 'S' }, grams: 350, naira: 25_000, stock: 6 },
      { sku: 'TEST-ADIRE-DRESS-M', options: { size: 'M' }, grams: 370, naira: 25_000, stock: 9 },
    ],
  },
  {
    name: 'Woven Handbag',
    category: "Women's Fashion",
    description: 'Test product. Raffia woven handbag.',
    variants: [{ sku: 'TEST-HANDBAG-WOVEN', grams: 500, naira: 15_000, stock: 11 }],
  },
  {
    name: 'Non-stick Pot Set',
    category: 'Home & Kitchen',
    brand: 'Kora Home',
    description: 'Test product. Three pots with glass lids.',
    variants: [{ sku: 'TEST-POTSET-3', grams: 4000, naira: 38_000, stock: 9 }],
  },
  {
    name: 'Electric Blender',
    category: 'Home & Kitchen',
    brand: 'Kora Home',
    description: 'Test product. 1.5 litre jar, two speeds.',
    variants: [{ sku: 'TEST-BLENDER-15', grams: 3000, naira: 32_500, stock: 14 }],
  },
  {
    name: 'Shea Butter Body Cream',
    category: 'Beauty & Health',
    brand: 'Eko Naturals',
    description: 'Test product. Unscented shea butter cream.',
    variants: [
      { sku: 'TEST-SHEA-250', options: { size: '250 ml' }, grams: 300, naira: 4_500, stock: 50 },
      { sku: 'TEST-SHEA-500', options: { size: '500 ml' }, grams: 560, naira: 7_800, stock: 30 },
    ],
  },
  {
    name: 'Black Soap',
    category: 'Beauty & Health',
    brand: 'Eko Naturals',
    description: 'Test product. Traditional black soap bar.',
    variants: [{ sku: 'TEST-BLACKSOAP', grams: 150, naira: 1_500, stock: 100 }],
  },
  {
    name: 'Ofada Rice 5kg',
    category: 'Groceries',
    brand: 'Farmgate',
    description: 'Test product. Locally grown ofada rice.',
    variants: [{ sku: 'TEST-OFADA-5KG', grams: 5000, naira: 11_000, stock: 40 }],
  },
  {
    name: 'Palm Oil 2 Litres',
    category: 'Groceries',
    brand: 'Farmgate',
    description: 'Test product. Red palm oil.',
    variants: [{ sku: 'TEST-PALMOIL-2L', grams: 2100, naira: 6_000, stock: 25 }],
  },
  {
    name: 'Baby Diapers Size 3',
    category: 'Baby Products',
    description: 'Test product. Pack of 60.',
    variants: [{ sku: 'TEST-DIAPER-S3', grams: 2000, naira: 14_500, stock: 20 }],
  },
  {
    name: 'Baby Feeding Bottle',
    category: 'Baby Products',
    description: 'Test product. 250 ml, BPA free.',
    variants: [{ sku: 'TEST-BOTTLE-250', grams: 150, naira: 3_500, stock: 1 }],
  },
];

const slugOf = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

async function main(): Promise<void> {
  const database = new URL(process.env.DATABASE_URL ?? 'postgres://x/none').pathname.slice(1);
  if (process.env.NODE_ENV === 'production' || !database.includes('dev')) {
    throw new Error(`Refusing to seed test products into "${database}". This is for local development databases only.`);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const catalogue = app.get(CatalogueService, { strict: false });
    const listings = app.get(ListingService, { strict: false });
    const inventory = app.get(InventoryService, { strict: false });
    const prisma = app.get(PrismaService, { strict: false });

    const categoryIds = new Map((await catalogue.listCategories()).map((c) => [c.name, c.id]));
    for (const category of CATEGORIES) {
      if (categoryIds.has(category.name)) continue;
      const parentId = category.parent ? categoryIds.get(category.parent) ?? null : null;
      const created = await catalogue.createCategory(SEEDER, { name: category.name, parentId, attributes: category.attributes ?? [] });
      categoryIds.set(category.name, created.id);
    }

    const brandIds = new Map((await catalogue.listBrands()).map((b) => [b.name, b.id]));
    for (const name of BRANDS) {
      if (!brandIds.has(name)) brandIds.set(name, (await catalogue.createBrand(SEEDER, name)).id);
    }

    const warehouse =
      (await inventory.listWarehouses())[0] ??
      (await inventory.createWarehouse(SEEDER, { name: 'Lagos test warehouse', address: { line1: '1 Test Street, Ikeja', city: 'Ikeja', state: 'Lagos' } }));

    let created = 0;
    let skipped = 0;
    for (const item of PRODUCTS) {
      if (await prisma.product.findUnique({ where: { slug: slugOf(item.name) }, select: { id: true } })) {
        skipped += 1;
        continue;
      }
      const categoryId = categoryIds.get(item.category);
      if (!categoryId) throw new Error(`Unknown category ${item.category}`);
      const product = await catalogue.createProduct(SEEDER, {
        categoryId,
        name: item.name,
        description: item.description,
        brandId: item.brand ? brandIds.get(item.brand) ?? null : null,
        attributes: item.attributes ?? {},
      });
      const variants = [];
      for (const variant of item.variants) {
        variants.push({ seed: variant, id: (await catalogue.addVariant(SEEDER, product.id, { sku: variant.sku, options: variant.options ?? {}, weightGrams: variant.grams })).id });
      }
      await catalogue.publish(SEEDER, product.id);
      for (const { seed, id } of variants) {
        const listing = await listings.create(SEEDER, { variantId: id, priceMinor: String(seed.naira * 100), currency: 'NGN' });
        await listings.activate(SEEDER, listing.id);
        if (seed.stock > 0) {
          await inventory.adjust(SEEDER, { listingId: listing.id, warehouseId: warehouse.id, delta: seed.stock, reason: 'receipt', idempotencyKey: `seed-${seed.sku}` });
        }
      }
      created += 1;
      console.log(`  ${item.name} (${item.category})`);
    }
    console.log(`Created ${created} test products in ${categoryIds.size} categories; ${skipped} already existed. Stock is in "${warehouse.name}".`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
