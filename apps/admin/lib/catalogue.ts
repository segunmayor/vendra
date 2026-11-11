import type { components } from '@vendra/api-client';

export type Category = components['schemas']['CategoryResponse'];
export type AttributeDefinition = components['schemas']['AttributeDefinitionResponse'];
export type AttributeValues = Record<string, string | number | boolean | null>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string): boolean => UUID.test(value);

export const fieldName = (key: string) => `attr.${key}`;

/**
 * Reads a category's attribute fields from a submitted form. Empty fields become null, which
 * clears the value. The API repeats every check, including required values on publish.
 */
export function readAttributes(
  definitions: readonly AttributeDefinition[],
  data: FormData,
): { ok: true; values: AttributeValues } | { ok: false; message: string } {
  const values: AttributeValues = {};
  for (const definition of definitions) {
    const raw = data.get(fieldName(definition.key));
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value === '') {
      values[definition.key] = null;
      continue;
    }
    switch (definition.type) {
      case 'number': {
        const number = Number(value);
        if (!Number.isFinite(number)) return { ok: false, message: `${definition.label} must be a number` };
        values[definition.key] = number;
        break;
      }
      case 'boolean':
        if (value !== 'yes' && value !== 'no') return { ok: false, message: `${definition.label} must be yes or no` };
        values[definition.key] = value === 'yes';
        break;
      default:
        values[definition.key] = value;
    }
  }
  return { ok: true, values };
}

/** Parses "Colour: Red" lines into variant options. */
export function readOptions(raw: string): { ok: true; options: Record<string, string> } | { ok: false; message: string } {
  const options: Record<string, string> = {};
  for (const line of raw.split('\n').map((entry) => entry.trim()).filter(Boolean)) {
    const separator = line.indexOf(':');
    const name = separator > 0 ? line.slice(0, separator).trim() : '';
    const value = separator > 0 ? line.slice(separator + 1).trim() : '';
    if (!name || !value) return { ok: false, message: `Write each option as "Name: Value" (problem with "${line}")` };
    if (name in options) return { ok: false, message: `The option "${name}" appears twice` };
    options[name] = value;
  }
  return { ok: true, options };
}

export const STATUS_TONE = { draft: 'warning', published: 'success', archived: 'neutral' } as const;
export const LISTING_TONE = { draft: 'warning', active: 'success', inactive: 'neutral' } as const;

export const ATTRIBUTE_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes or no' },
  { value: 'select', label: 'Choice from a list' },
] as const;

/** Reads the attribute rows of the category form. Blank and removed rows are skipped; the API validates the rest. */
export function readDefinitions(data: FormData): AttributeDefinition[] {
  const rows = Number(data.get('rows'));
  const definitions: AttributeDefinition[] = [];
  for (let index = 0; index < (Number.isInteger(rows) ? Math.min(rows, 60) : 0); index += 1) {
    const field = (name: string) => {
      const value = data.get(`attributes.${index}.${name}`);
      return typeof value === 'string' ? value.trim() : '';
    };
    if (data.get(`attributes.${index}.remove`) === 'on') continue;
    const key = field('key');
    const label = field('label');
    if (!key && !label) continue;
    const type = field('type');
    definitions.push({
      key,
      label,
      type: type as AttributeDefinition['type'],
      required: data.get(`attributes.${index}.required`) === 'on',
      ...(type === 'select' ? { options: field('options').split(',').map((option) => option.trim()).filter(Boolean) } : {}),
    });
  }
  return definitions;
}
