import type { AttributeDefinition, BrandView, CategoryView, ProductState, WarehouseView } from './contracts';
import { Issue, ProductDraft } from '../domain/drafts';
import { ImportMode, ItemAction, ItemStatus, PlannedProduct, PlannedVariant } from './ports';

/** What the planner needs to know about the catalogue as it is now. */
export interface PlanContext {
  readonly mode: ImportMode;
  readonly categories: readonly CategoryView[];
  readonly brands: readonly BrandView[];
  readonly warehouses: readonly WarehouseView[];
  /** Existing products by slug, for the handles in the file. */
  readonly existing: ReadonlyMap<string, ProductState>;
  /** The product that owns each SKU in the file, if any. */
  readonly skuOwners: ReadonlyMap<string, string>;
  readonly createMissingBrands: boolean;
}

export interface PlannedItem {
  readonly handle: string;
  readonly name: string;
  readonly lines: readonly number[];
  readonly skus: readonly string[];
  readonly action: ItemAction;
  readonly status: ItemStatus;
  readonly errors: readonly Issue[];
  readonly warnings: readonly Issue[];
  readonly payload: PlannedProduct | null;
  readonly productId: string | null;
}

const key = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');
const slugOf = (text: string) => key(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Finds a category by web address, by name (when unique), or by a path such as "Fashion > Men". */
export function categoryResolver(categories: readonly CategoryView[]): (ref: string) => { category: CategoryView } | { error: string } {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const pathOf = (category: CategoryView): string => {
    const names: string[] = [];
    for (let at: CategoryView | undefined = category, depth = 0; at && depth < 20; at = at.parentId ? byId.get(at.parentId) : undefined, depth += 1) {
      names.unshift(key(at.name));
    }
    return names.join(' > ');
  };
  const bySlug = new Map(categories.map((category) => [category.slug, category]));
  const byPath = new Map(categories.map((category) => [pathOf(category), category]));
  const byName = new Map<string, CategoryView[]>();
  for (const category of categories) byName.set(key(category.name), [...(byName.get(key(category.name)) ?? []), category]);

  return (ref) => {
    const wanted = key(ref);
    const path = wanted.split(/\s*(?:>|\/)\s*/).filter(Boolean).join(' > ');
    const found = byPath.get(path) ?? bySlug.get(ref.trim().toLowerCase()) ?? (byName.get(wanted)?.length === 1 ? byName.get(wanted)![0] : undefined);
    if (found) return { category: found };
    const named = byName.get(wanted);
    if (named && named.length > 1) {
      return { error: `More than one category is called "${ref}". Use its path, such as "${pathOf(named[0]!).replace(/(^|> )(\w)/g, (m) => m.toUpperCase())}", or its web address.` };
    }
    return { error: `There is no category "${ref}". Create it in Categories first, or use an existing name.` };
  };
}

const TRUE = new Set(['yes', 'true', '1', 'y']);
const FALSE = new Set(['no', 'false', '0', 'n']);

/** Converts attribute text from the file to the category's types. */
function typedAttributes(
  definitions: readonly AttributeDefinition[],
  raw: Readonly<Record<string, string>>,
  line: number,
  errors: Issue[],
): Record<string, string | number | boolean> {
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
  const result: Record<string, string | number | boolean> = {};
  for (const [name, text] of Object.entries(raw)) {
    const definition = byKey.get(name);
    const field = `attr:${name}`;
    if (!definition) {
      const known = definitions.map((d) => d.key).join(', ');
      errors.push({ line, field, message: `This category has no attribute "${name}".${known ? ` Its attributes are: ${known}.` : ' It has no attributes.'}` });
      continue;
    }
    switch (definition.type) {
      case 'number': {
        const value = Number(text.replace(/,/g, ''));
        if (!Number.isFinite(value)) errors.push({ line, field, message: `${definition.label} must be a number` });
        else result[name] = value;
        break;
      }
      case 'boolean':
        if (TRUE.has(text.toLowerCase())) result[name] = true;
        else if (FALSE.has(text.toLowerCase())) result[name] = false;
        else errors.push({ line, field, message: `${definition.label} must be yes or no` });
        break;
      case 'select': {
        const option = definition.options?.find((candidate) => candidate.toLowerCase() === text.toLowerCase());
        if (!option) errors.push({ line, field, message: `${definition.label} must be one of: ${definition.options?.join(', ')}` });
        else result[name] = option;
        break;
      }
      default:
        if (text.length > 500) errors.push({ line, field, message: `${definition.label} is limited to 500 characters` });
        else result[name] = text;
    }
  }
  return result;
}

/** Checks each draft against the catalogue and decides what will happen to it. Nothing is changed. */
export function planImport(drafts: readonly ProductDraft[], context: PlanContext): PlannedItem[] {
  const resolveCategory = categoryResolver(context.categories);
  const brandByName = new Map(context.brands.map((brand) => [key(brand.name), brand]));
  const brandBySlug = new Map(context.brands.map((brand) => [brand.slug, brand]));
  const warehouseByName = new Map(context.warehouses.map((warehouse) => [key(warehouse.name), warehouse]));
  const onlyWarehouse = context.warehouses.length === 1 ? context.warehouses[0]! : null;

  return drafts.map((draft): PlannedItem => {
    const errors: Issue[] = [...draft.errors];
    const warnings: Issue[] = [...draft.warnings];
    const first = draft.lines[0]!;
    const existing = context.existing.get(draft.handle) ?? null;
    const base = { handle: draft.handle, name: draft.name || draft.handle, lines: draft.lines, skus: draft.variants.map((v) => v.sku), productId: existing?.id ?? null };

    if (existing && context.mode === 'create_only') {
      return {
        ...base,
        action: 'skip',
        status: 'skipped',
        errors: [],
        warnings: [{ line: first, field: 'handle', message: `A product with the handle "${draft.handle}" already exists, so it was left as it is. Choose "Create and update" to change it.` }],
        payload: null,
      };
    }

    let category: CategoryView | null = null;
    if (draft.category) {
      const resolved = resolveCategory(draft.category);
      if ('error' in resolved) errors.push({ line: first, field: 'category', message: resolved.error });
      else category = resolved.category;
    }
    if (existing && category && category.id !== existing.categoryId) {
      warnings.push({ line: first, field: 'category', message: 'Imports do not move a product to another category; the current category was kept.' });
      category = context.categories.find((c) => c.id === existing.categoryId) ?? category;
    }

    let brandId: string | null = null;
    let brandToCreate: string | null = null;
    if (draft.brand) {
      const brand = brandByName.get(key(draft.brand)) ?? brandBySlug.get(slugOf(draft.brand));
      if (brand) brandId = brand.id;
      else if (context.createMissingBrands) {
        brandToCreate = draft.brand.trim();
        warnings.push({ line: first, field: 'brand', message: `The brand "${brandToCreate}" will be created` });
      } else errors.push({ line: first, field: 'brand', message: `There is no brand "${draft.brand}". Create it in Brands first.` });
    }

    let attributes: Record<string, string | number | boolean> = {};
    if (category) {
      attributes = typedAttributes(category.attributes, draft.attributes, first, errors);
      const merged = { ...(existing?.attributes ?? {}), ...attributes };
      if (draft.status === 'published') {
        const missing = category.attributes.filter((d) => d.required && (merged[d.key] === undefined || merged[d.key] === ''));
        for (const definition of missing) {
          errors.push({ line: first, field: `attr:${definition.key}`, message: `${definition.label} is required to publish in ${category.name}. Add an attr:${definition.key} column, or set status to draft.` });
        }
      }
    }

    if (existing?.status === 'published' && draft.status === 'draft') {
      warnings.push({ line: first, field: 'status', message: 'The product is already on sale; an import does not take it off sale. Archive it in Products instead.' });
    }

    const existingSkus = new Map((existing?.variants ?? []).map((variant) => [variant.sku, variant]));
    const variants: PlannedVariant[] = [];
    for (const variant of draft.variants) {
      const owner = context.skuOwners.get(variant.sku);
      if (owner && owner !== existing?.id) {
        errors.push({ line: variant.line, field: 'sku', message: `SKU ${variant.sku} already belongs to another product` });
        continue;
      }
      const current = existingSkus.get(variant.sku);
      if (current && (current.weightGrams !== variant.weightGrams || JSON.stringify(current.options) !== JSON.stringify(variant.options))) {
        warnings.push({ line: variant.line, field: 'sku', message: `SKU ${variant.sku} exists; its weight and options are kept as they are. Price and stock are updated.` });
      }
      let warehouseId: string | null = null;
      if (variant.stock !== null) {
        if (variant.warehouse) {
          const warehouse = warehouseByName.get(key(variant.warehouse));
          if (!warehouse) errors.push({ line: variant.line, field: 'warehouse', message: `There is no warehouse "${variant.warehouse}"` });
          else warehouseId = warehouse.id;
        } else if (onlyWarehouse) warehouseId = onlyWarehouse.id;
        else if (context.warehouses.length === 0) errors.push({ line: variant.line, field: 'warehouse', message: 'Create a warehouse before importing stock' });
        else errors.push({ line: variant.line, field: 'warehouse', message: 'There are several warehouses, so say which one holds this stock' });
      }
      variants.push({ ...variant, warehouseId });
    }

    const status: ItemStatus = errors.length ? 'invalid' : 'ready';
    const payload: PlannedProduct | null =
      status === 'ready' && category
        ? {
            handle: draft.handle,
            name: draft.name,
            description: existing && !draft.description ? null : draft.description,
            categoryId: category.id,
            brandId,
            brandToCreate,
            keepBrand: !draft.brand,
            status: draft.status,
            images: draft.images,
            attributes,
            variants,
          }
        : null;
    return { ...base, action: existing ? 'update' : 'create', status, errors, warnings, payload };
  });
}
