import { MAX_OPTIONS } from './columns';

/**
 * Turns source records (CSV rows now, JSON or XML objects later) into product drafts: values
 * parsed and normalised, rows grouped by handle, every problem tied to the row it came from.
 * Checks that need the database (categories, brands, warehouses, SKUs in use) come later.
 */

export interface Issue {
  /** Line in the file, or null for a problem with the whole product or file. */
  readonly line: number | null;
  readonly field: string | null;
  readonly message: string;
}

/** One row, with headers already mapped to column names. */
export interface SourceRecord {
  readonly line: number;
  readonly values: Readonly<Record<string, string>>;
  /** option1 to option3, as given; gaps allowed. */
  readonly options: readonly { readonly index: number; readonly name: string; readonly value: string }[];
  /** From image_1 to image_10, in order. */
  readonly imageColumns: readonly string[];
  readonly attributes: Readonly<Record<string, string>>;
}

export interface VariantDraft {
  readonly line: number;
  readonly sku: string;
  readonly options: Readonly<Record<string, string>>;
  readonly weightGrams: number;
  /** What the customer pays, in kobo. */
  readonly priceMinor: string;
  /** The usual price shown struck through, in kobo; null when not discounted. */
  readonly compareAtMinor: string | null;
  readonly currency: string;
  /** Units on hand to set; null leaves stock alone. */
  readonly stock: number | null;
  readonly warehouse: string | null;
}

export interface ProductDraft {
  readonly handle: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly brand: string | null;
  readonly status: 'published' | 'draft';
  readonly images: readonly string[];
  readonly attributes: Readonly<Record<string, string>>;
  readonly variants: readonly VariantDraft[];
  readonly lines: readonly number[];
  readonly errors: readonly Issue[];
  readonly warnings: readonly Issue[];
}

export interface DraftLimits {
  readonly maxImages: number;
}

const SKU = /^[A-Z0-9][A-Z0-9._-]{1,63}$/;
const MAX_STOCK = 1_000_000;
const MAX_WEIGHT = 1_000_000;
const MAX_DESCRIPTION = 5000;

/** The same rule the catalogue uses for web addresses, so a handle and its product's slug always match. */
export function toHandle(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

/** Naira as typed in a spreadsheet ("₦15,000.50", "NGN 15000") to kobo. Null if unreadable. */
export function nairaToMinor(raw: string): bigint | null {
  const compact = raw.replace(/₦|ngn|naira|n(?=\d)/gi, '').replace(/[\s,]/g, '');
  const match = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(compact);
  if (!match) return null;
  return BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
}

function wholeNumber(raw: string, max: number): number | null {
  const compact = raw.replace(/[\s,]/g, '');
  if (!/^\d+$/.test(compact)) return null;
  const value = Number(compact);
  return value <= max ? value : null;
}

const STATUS: Record<string, 'published' | 'draft'> = {
  published: 'published', publish: 'published', active: 'published', live: 'published', yes: 'published', true: 'published', '1': 'published',
  draft: 'draft', inactive: 'draft', hidden: 'draft', no: 'draft', false: 'draft', '0': 'draft',
};

const splitImages = (raw: string): string[] => raw.split(/[|\n\r]+|\s+(?=https?:\/\/)/i).map((url) => url.trim()).filter(Boolean);

interface Group {
  handle: string;
  records: SourceRecord[];
}

/** Groups records by handle, in order of first appearance. A blank handle falls back to the name. */
function group(records: readonly SourceRecord[], fileIssues: Issue[]): Group[] {
  const groups = new Map<string, Group>();
  for (const record of records) {
    const explicit = record.values.handle?.trim() ?? '';
    const handle = toHandle(explicit || (record.values.name ?? ''));
    if (!handle) {
      fileIssues.push({ line: record.line, field: 'handle', message: 'Give the row a handle or a name' });
      continue;
    }
    let entry = groups.get(handle);
    if (!entry) groups.set(handle, (entry = { handle, records: [] }));
    entry.records.push(record);
  }
  return [...groups.values()];
}

/**
 * Product values may be repeated on every row or given once. A different value on a later
 * row is almost always a mistake (two products sharing a handle), so it is an error.
 */
function productValue(records: readonly SourceRecord[], field: string, errors: Issue[], read = (r: SourceRecord) => r.values[field]?.trim() ?? ''): string {
  let found: { value: string; line: number } | null = null;
  for (const record of records) {
    const value = read(record);
    if (!value) continue;
    if (!found) found = { value, line: record.line };
    else if (value !== found.value) {
      errors.push({ line: record.line, field, message: `${field} differs from row ${found.line} of the same product. Use one value, or give the rows different handles.` });
    }
  }
  return found?.value ?? '';
}

function readVariant(record: SourceRecord, errors: Issue[]): VariantDraft | null {
  const value = (field: string) => record.values[field]?.trim() ?? '';
  const problem = (field: string, message: string) => errors.push({ line: record.line, field, message });
  const before = errors.length;

  const sku = value('sku').toUpperCase();
  if (!sku) problem('sku', 'SKU is required');
  else if (!SKU.test(sku)) problem('sku', 'SKUs are 2 to 64 letters, digits, dots, dashes or underscores, starting with a letter or digit');

  const options: Record<string, string> = {};
  for (const option of [...record.options].sort((a, b) => a.index - b.index)) {
    const name = option.name.trim();
    const optionValue = option.value.trim();
    if (!name && !optionValue) continue;
    if (!name || !optionValue) {
      problem(`option${option.index}`, `option${option.index}_name and option${option.index}_value go together`);
      continue;
    }
    if (name.length > 40 || optionValue.length > 80) problem(`option${option.index}`, 'Option names are up to 40 characters, values up to 80');
    if (Object.keys(options).some((existing) => existing.toLowerCase() === name.toLowerCase())) {
      problem(`option${option.index}`, `The option "${name}" appears twice`);
      continue;
    }
    options[name] = optionValue;
  }

  let weightGrams = 0;
  const grams = value('weight_grams');
  const kg = value('weight_kg');
  if (grams && kg) problem('weight_grams', 'Give weight_grams or weight_kg, not both');
  else if (grams) {
    const parsed = wholeNumber(grams, MAX_WEIGHT);
    if (!parsed) problem('weight_grams', 'Weight must be a whole number of grams, from 1 to 1,000,000');
    else weightGrams = parsed;
  } else if (kg) {
    const parsed = /^\d{1,4}(?:\.\d{1,3})?$/.test(kg.replace(/\s/g, '')) ? Math.round(Number(kg) * 1000) : 0;
    if (parsed <= 0 || parsed > MAX_WEIGHT) problem('weight_kg', 'Weight must be in kilograms, such as 0.45, up to 1,000');
    else weightGrams = parsed;
  } else problem('weight_grams', 'Weight is required (weight_grams or weight_kg), for delivery prices');

  const currency = (value('currency') || 'NGN').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) problem('currency', 'Currency is a three-letter code such as NGN');

  const price = value('price');
  const regular = price ? nairaToMinor(price) : null;
  if (!price) problem('price', 'Price is required');
  else if (regular === null || regular <= 0n) problem('price', 'Price must be an amount in naira above zero, such as 15000 or 15,000.50');

  let selling = regular;
  let compareAt: bigint | null = null;
  const sale = value('sale_price');
  const percent = value('discount_percent').replace(/%$/, '').trim();
  if (sale && percent) problem('sale_price', 'Give sale_price or discount_percent, not both');
  else if (sale && regular) {
    const parsed = nairaToMinor(sale);
    if (parsed === null || parsed <= 0n) problem('sale_price', 'Sale price must be an amount in naira above zero');
    else if (parsed >= regular) problem('sale_price', 'Sale price must be lower than price. Leave it blank for no discount.');
    else [selling, compareAt] = [parsed, regular];
  } else if (percent && regular) {
    const parsed = /^\d{1,2}(?:\.\d{1,2})?$/.test(percent) ? Number(percent) : NaN;
    if (!(parsed >= 1 && parsed <= 95)) problem('discount_percent', 'Discount must be a percentage from 1 to 95');
    else {
      // Rounded to whole naira, so shelf prices stay tidy.
      const discounted = ((regular * BigInt(Math.round((100 - parsed) * 100)) + 500_000n) / 1_000_000n) * 100n;
      if (discounted <= 0n || discounted >= regular) problem('discount_percent', 'That discount leaves no sensible price');
      else [selling, compareAt] = [discounted, regular];
    }
  }

  const stockRaw = value('stock');
  let stock: number | null = null;
  if (stockRaw) {
    stock = wholeNumber(stockRaw, MAX_STOCK);
    if (stock === null) problem('stock', `Stock must be a whole number from 0 to ${MAX_STOCK.toLocaleString('en-NG')}`);
  }

  if (errors.length > before || !selling) return null;
  return {
    line: record.line,
    sku,
    options,
    weightGrams,
    priceMinor: selling.toString(),
    compareAtMinor: compareAt?.toString() ?? null,
    currency,
    stock,
    warehouse: value('warehouse') || null,
  };
}

function buildDraft(entry: Group, limits: DraftLimits): ProductDraft {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const { records } = entry;
  const lines = records.map((record) => record.line);
  const first = lines[0]!;

  const name = productValue(records, 'name', errors);
  if (!name) errors.push({ line: first, field: 'name', message: 'Name is required' });
  else if (name.length < 2 || name.length > 200) errors.push({ line: first, field: 'name', message: 'Names must be 2 to 200 characters' });

  const description = productValue(records, 'description', errors);
  if (description.length > MAX_DESCRIPTION) {
    errors.push({ line: first, field: 'description', message: `Descriptions are limited to ${MAX_DESCRIPTION.toLocaleString('en-NG')} characters` });
  }

  const category = productValue(records, 'category', errors);
  if (!category) errors.push({ line: first, field: 'category', message: 'Category is required' });

  const brand = productValue(records, 'brand', errors) || null;
  if (brand && (brand.length < 2 || brand.length > 100)) errors.push({ line: first, field: 'brand', message: 'Brand names must be 2 to 100 characters' });

  const statusRaw = productValue(records, 'status', errors).toLowerCase();
  const status = statusRaw ? STATUS[statusRaw] : 'published';
  if (!status) errors.push({ line: first, field: 'status', message: 'Status must be "published" or "draft"' });

  const imageText = productValue(records, 'images', errors, (record) =>
    [...splitImages(record.values.images ?? ''), ...record.imageColumns.map((url) => url.trim()).filter(Boolean)].join('|'),
  );
  let images = [...new Set(imageText ? imageText.split('|') : [])];
  if (images.length > limits.maxImages) {
    warnings.push({ line: first, field: 'images', message: `Only the first ${limits.maxImages} photos are used; ${images.length - limits.maxImages} ignored` });
    images = images.slice(0, limits.maxImages);
  }

  const attributeKeys = [...new Set(records.flatMap((record) => Object.keys(record.attributes)))];
  const attributes: Record<string, string> = {};
  for (const key of attributeKeys) {
    const value = productValue(records, `attr:${key}`, errors, (record) => record.attributes[key]?.trim() ?? '');
    if (value) attributes[key] = value;
  }

  const variants = records.map((record) => readVariant(record, errors)).filter((variant): variant is VariantDraft => !!variant);
  if (records.length > 1) {
    const seen = new Map<string, number>();
    for (const variant of variants) {
      if (Object.keys(variant.options).length === 0) {
        errors.push({ line: variant.line, field: 'option1_name', message: 'This product has several rows, so each needs an option (such as Size: M) to tell them apart' });
        continue;
      }
      const combination = JSON.stringify(Object.entries(variant.options).map(([k, v]) => [k.toLowerCase(), v.toLowerCase()]).sort());
      const earlier = seen.get(combination);
      if (earlier !== undefined) errors.push({ line: variant.line, field: 'option1_value', message: `Same options as row ${earlier}` });
      else seen.set(combination, variant.line);
    }
  }
  const currencies = new Set(variants.map((variant) => variant.currency));
  if (currencies.size > 1) errors.push({ line: first, field: 'currency', message: 'All variants of a product must use the same currency' });

  return { handle: entry.handle, name, description, category, brand, status: status ?? 'published', images, attributes, variants, lines, errors, warnings };
}

/** Drafts for every product in the file, plus problems that belong to no single product. */
export function buildDrafts(records: readonly SourceRecord[], limits: DraftLimits): { drafts: ProductDraft[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const drafts = group(records, issues).map((entry) => buildDraft(entry, limits));

  // A SKU may appear only once in a file, whichever product it is on.
  const skuLine = new Map<string, number>();
  const withDuplicates = drafts.map((draft) => {
    const extra: Issue[] = [];
    for (const variant of draft.variants) {
      const earlier = skuLine.get(variant.sku);
      if (earlier !== undefined) extra.push({ line: variant.line, field: 'sku', message: `SKU ${variant.sku} is also on row ${earlier}` });
      else skuLine.set(variant.sku, variant.line);
    }
    return extra.length ? { ...draft, errors: [...draft.errors, ...extra] } : draft;
  });
  return { drafts: withDuplicates, issues };
}

export { MAX_OPTIONS };
