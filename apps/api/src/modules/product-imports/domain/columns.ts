/**
 * The columns of a product file. One row is one variant (one SKU); rows with the same handle
 * are one product. JSON and XML imports will use the same names as object keys.
 */
export type ColumnLevel = 'product' | 'variant';

export interface ColumnSpec {
  readonly name: string;
  readonly level: ColumnLevel;
  readonly required: boolean;
  readonly description: string;
  readonly example: string;
  readonly aliases?: readonly string[];
}

export const MAX_OPTIONS = 3;
export const MAX_IMAGE_COLUMNS = 10;

export const COLUMNS: readonly ColumnSpec[] = [
  { name: 'handle', level: 'product', required: false, example: 'nova-x5-smartphone', aliases: ['product_handle', 'product_id', 'slug'],
    description: 'Groups rows into one product and becomes its web address. Rows with the same handle are variants of one product. Leave blank to use the name. Importing the same handle again updates that product.' },
  { name: 'name', level: 'product', required: true, example: 'Nova X5 Smartphone', aliases: ['title', 'product_name'],
    description: 'Product name, 2 to 200 characters.' },
  { name: 'description', level: 'product', required: false, example: '6.5 inch display, dual SIM, 5000 mAh battery.', aliases: ['body', 'details'],
    description: 'Up to 5,000 characters. Line breaks are kept.' },
  { name: 'category', level: 'product', required: true, example: 'Smartphones', aliases: ['category_name', 'category_slug'],
    description: 'An existing category, by name, web address, or path such as "Phones & Tablets > Smartphones". Categories are not created by imports.' },
  { name: 'brand', level: 'product', required: false, example: 'Nova Mobile', aliases: ['brand_name', 'vendor', 'manufacturer'],
    description: 'Brand name. Unknown brands are created, unless that is turned off in Settings.' },
  { name: 'status', level: 'product', required: false, example: 'published', aliases: ['publish', 'state'],
    description: '"published" (the default) puts the product on sale; "draft" saves it for later.' },
  { name: 'images', level: 'product', required: false, example: 'https://example.com/x5-front.jpg | https://example.com/x5-back.jpg', aliases: ['image_urls', 'photos', 'pictures'],
    description: 'Photo addresses (https://), separated by | or new lines. The first is the main photo. Or use image_1 to image_10. Photos are downloaded and stored by Vendra.' },
  { name: 'sku', level: 'variant', required: true, example: 'NOVA-X5-128', aliases: ['variant_sku', 'code', 'product_code'],
    description: 'Your stock code, unique across the catalogue: 2 to 64 letters, digits, dots, dashes or underscores.' },
  { name: 'option1_name', level: 'variant', required: false, example: 'Storage', aliases: ['option_1_name'],
    description: 'What makes this variant different, such as Size or Colour. Use option2_ and option3_ for more. Needed when a product has more than one row.' },
  { name: 'option1_value', level: 'variant', required: false, example: '128 GB', aliases: ['option_1_value'],
    description: 'The value for option1_name, such as XL or Red.' },
  { name: 'price', level: 'variant', required: true, example: '215000', aliases: ['regular_price', 'price_naira'],
    description: 'The usual price in naira, such as 15000 or 15,000.50.' },
  { name: 'sale_price', level: 'variant', required: false, example: '185000', aliases: ['discounted_price', 'special_price'],
    description: 'Discounted price in naira, lower than price. Customers see price struck through. Leave blank for no discount.' },
  { name: 'discount_percent', level: 'variant', required: false, example: '', aliases: ['discount', 'discount_percentage'],
    description: 'Instead of sale_price: a discount from 1 to 95 percent off price, rounded to the nearest naira.' },
  { name: 'currency', level: 'variant', required: false, example: 'NGN',
    description: 'Defaults to NGN.' },
  { name: 'weight_grams', level: 'variant', required: false, example: '450', aliases: ['weight_g', 'weight'],
    description: 'Packed weight in grams, used for delivery prices. Required, unless weight_kg is given.' },
  { name: 'weight_kg', level: 'variant', required: false, example: '', aliases: [],
    description: 'Packed weight in kilograms, instead of weight_grams.' },
  { name: 'stock', level: 'variant', required: false, example: '25', aliases: ['quantity', 'qty', 'stock_quantity', 'inventory'],
    description: 'Units on hand in the warehouse. On an update the stock is set to this number. Leave blank to leave stock alone.' },
  { name: 'warehouse', level: 'variant', required: false, example: 'Lagos warehouse', aliases: ['location', 'warehouse_name', 'stock_location'],
    description: 'The warehouse holding the stock, by name. May be left blank when there is only one warehouse.' },
];

export const ATTRIBUTE_PREFIXES = ['attr:', 'attr.', 'attribute:', 'attribute.'] as const;

/** Lower case, with spaces, dashes and repeated underscores turned into single underscores. */
export const normaliseHeader = (header: string): string =>
  header.trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/_+/g, '_');

export type HeaderTarget =
  | { readonly kind: 'column'; readonly name: string }
  | { readonly kind: 'option'; readonly index: number; readonly part: 'name' | 'value' }
  | { readonly kind: 'image'; readonly index: number }
  | { readonly kind: 'attribute'; readonly key: string }
  | { readonly kind: 'unknown' };

const BY_NAME = new Map<string, string>(
  COLUMNS.flatMap((column) => [[column.name, column.name] as const, ...(column.aliases ?? []).map((alias) => [alias, column.name] as const)]),
);

/** What a header refers to. Unknown headers are reported once, then ignored. */
export function classifyHeader(raw: string): HeaderTarget {
  const trimmed = raw.trim();
  for (const prefix of ATTRIBUTE_PREFIXES) {
    if (trimmed.toLowerCase().startsWith(prefix)) return { kind: 'attribute', key: normaliseHeader(trimmed.slice(prefix.length)) };
  }
  const header = normaliseHeader(trimmed);
  const option = /^option_?(\d+)_(name|value)$/.exec(header);
  if (option) {
    const index = Number(option[1]);
    return index >= 1 && index <= MAX_OPTIONS ? { kind: 'option', index, part: option[2] as 'name' | 'value' } : { kind: 'unknown' };
  }
  const image = /^(?:image|photo|picture)_?(\d+)(?:_url)?$/.exec(header);
  if (image) {
    const index = Number(image[1]);
    return index >= 1 && index <= MAX_IMAGE_COLUMNS ? { kind: 'image', index } : { kind: 'unknown' };
  }
  const name = BY_NAME.get(header);
  return name ? { kind: 'column', name } : { kind: 'unknown' };
}
