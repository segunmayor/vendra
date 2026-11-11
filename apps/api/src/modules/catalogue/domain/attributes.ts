import { DomainError } from '../../../shared-kernel';

export type AttributeType = 'text' | 'number' | 'boolean' | 'select';
export type AttributeValue = string | number | boolean;

/** One category-specific field, such as screen size for phones or fabric for clothing. */
export interface AttributeDefinition {
  readonly key: string;
  readonly label: string;
  readonly type: AttributeType;
  readonly required: boolean;
  readonly options?: readonly string[];
}

const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const TYPES: readonly string[] = ['text', 'number', 'boolean', 'select'];
const MAX_DEFINITIONS = 50;

const schemaError = (message: string) => new DomainError('category.invalid_attributes', message);
const valueError = (message: string) => new DomainError('product.invalid_attributes', message);

export function parseAttributeSchema(raw: unknown): AttributeDefinition[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) throw schemaError('Attributes must be a list');
  if (raw.length > MAX_DEFINITIONS) throw schemaError(`At most ${MAX_DEFINITIONS} attributes are allowed`);
  const seen = new Set<string>();
  return raw.map((item: unknown, index): AttributeDefinition => {
    if (typeof item !== 'object' || item === null) throw schemaError(`Attribute ${index + 1} is not an object`);
    const { key, label, type, required, options } = item as Record<string, unknown>;
    if (typeof key !== 'string' || !KEY.test(key)) {
      throw schemaError(`Attribute ${index + 1} needs a lowercase key such as "screen_size"`);
    }
    if (seen.has(key)) throw schemaError(`Duplicate attribute key: ${key}`);
    seen.add(key);
    if (typeof label !== 'string' || !label.trim() || label.length > 80) {
      throw schemaError(`Attribute ${key} needs a label of up to 80 characters`);
    }
    if (typeof type !== 'string' || !TYPES.includes(type)) throw schemaError(`Attribute ${key} has an unknown type`);
    if (required !== undefined && typeof required !== 'boolean') {
      throw schemaError(`Attribute ${key}: required must be true or false`);
    }
    const base = { key, label: label.trim(), type: type as AttributeType, required: required === true };
    if (type !== 'select') {
      if (options !== undefined) throw schemaError(`Only select attributes take options (${key})`);
      return base;
    }
    if (
      !Array.isArray(options) ||
      options.length === 0 ||
      options.some((option) => typeof option !== 'string' || !option.trim())
    ) {
      throw schemaError(`Attribute ${key} needs a list of options`);
    }
    return { ...base, options: [...new Set((options as string[]).map((option) => option.trim()))] };
  });
}

/** Checks values against a category's definitions. Publishing also requires every required value. */
export function validateAttributes(
  definitions: readonly AttributeDefinition[],
  values: Readonly<Record<string, unknown>>,
  requireAll: boolean,
): Record<string, AttributeValue> {
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
  const result: Record<string, AttributeValue> = {};
  for (const [key, value] of Object.entries(values)) {
    const definition = byKey.get(key);
    if (!definition) throw valueError(`Unknown attribute: ${key}`);
    if (value === null || value === undefined || value === '') continue;
    const { label } = definition;
    switch (definition.type) {
      case 'text':
        if (typeof value !== 'string' || value.length > 500) throw valueError(`${label} must be text of up to 500 characters`);
        result[key] = value.trim();
        break;
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) throw valueError(`${label} must be a number`);
        result[key] = value;
        break;
      case 'boolean':
        if (typeof value !== 'boolean') throw valueError(`${label} must be yes or no`);
        result[key] = value;
        break;
      case 'select':
        if (typeof value !== 'string' || !definition.options?.includes(value)) {
          throw valueError(`${label} must be one of: ${definition.options?.join(', ')}`);
        }
        result[key] = value;
        break;
    }
  }
  if (requireAll) {
    const missing = definitions.filter((d) => d.required && !(d.key in result)).map((d) => d.label);
    if (missing.length > 0) {
      throw new DomainError('product.missing_attributes', `Required before publishing: ${missing.join(', ')}`);
    }
  }
  return result;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function toSlug(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  if (!SLUG.test(slug)) throw new DomainError('catalogue.invalid_slug', 'Use letters or numbers for the web address');
  return slug;
}

export function assertName(name: string, max = 200): string {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > max) {
    throw new DomainError('catalogue.invalid_name', `Names must be 2 to ${max} characters`);
  }
  return trimmed;
}
