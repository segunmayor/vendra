import { DomainError } from '../../../shared-kernel';
import { AttributeDefinition, parseAttributeSchema, toSlug, validateAttributes } from './attributes';
import { Product } from './product';

const now = new Date('2026-11-11T10:00:00Z');
const phone: AttributeDefinition[] = parseAttributeSchema([
  { key: 'screen_size', label: 'Screen size', type: 'number', required: true },
  { key: 'network', label: 'Network', type: 'select', options: ['4G', '5G'], required: true },
  { key: 'dual_sim', label: 'Dual SIM', type: 'boolean' },
  { key: 'notes', label: 'Notes', type: 'text' },
]);
const make = (attributes: Record<string, unknown> = {}) =>
  Product.create(
    { id: 'p1', categoryId: 'c1', brandId: null, name: 'Tecno Spark 20', description: 'A phone', attributes },
    phone,
  );
const variant = (sku = 'TS20-BLK') => ({ id: `v-${sku}`, sku, options: { colour: 'Black' }, weightGrams: 190 });

describe('attribute schema', () => {
  it.each<[string, unknown]>([
    ['not a list', { key: 'a' }],
    ['a bad key', [{ key: 'Screen Size', label: 'x', type: 'text' }]],
    ['a duplicate key', [{ key: 'a', label: 'A', type: 'text' }, { key: 'a', label: 'B', type: 'text' }]],
    ['an unknown type', [{ key: 'a', label: 'A', type: 'date' }]],
    ['a select without options', [{ key: 'a', label: 'A', type: 'select' }]],
    ['options on a text field', [{ key: 'a', label: 'A', type: 'text', options: ['x'] }]],
    ['a missing label', [{ key: 'a', type: 'text' }]],
  ])('rejects %s', (_name, raw) => {
    expect(() => parseAttributeSchema(raw)).toThrow(DomainError);
  });

  it('treats a missing schema as no attributes', () => {
    expect(parseAttributeSchema(null)).toEqual([]);
  });
});

describe('attribute values', () => {
  it.each<[string, Record<string, unknown>]>([
    ['an unknown key', { colour: 'red' }],
    ['text for a number', { screen_size: '6.5' }],
    ['a value outside the options', { network: '3G' }],
    ['a string for a boolean', { dual_sim: 'yes' }],
  ])('rejects %s', (_name, values) => {
    expect(() => validateAttributes(phone, values, false)).toThrow(DomainError);
  });

  it('drops empty values and keeps valid ones', () => {
    expect(validateAttributes(phone, { screen_size: 6.5, notes: '' }, false)).toEqual({ screen_size: 6.5 });
  });

  it('requires every required value when asked', () => {
    expect(() => validateAttributes(phone, { screen_size: 6.5 }, true)).toThrow('Network');
  });
});

describe('Product', () => {
  it('starts as a draft with a slug derived from its name', () => {
    const product = make();
    expect(product.snapshot.status).toBe('draft');
    expect(product.snapshot.slug).toBe('tecno-spark-20');
  });

  it('allows a draft to be incomplete', () => {
    expect(() => make({})).not.toThrow();
  });

  it('cannot be published without a variant', () => {
    const product = make({ screen_size: 6.5, network: '4G' });
    expect(() => product.publish(phone, now)).toThrow('variant');
  });

  it('cannot be published with required attributes missing', () => {
    const product = make({ screen_size: 6.5 });
    product.addVariant(variant(), now);
    expect(() => product.publish(phone, now)).toThrow('Network');
  });

  it('publishes once and raises an event', () => {
    const product = make({ screen_size: 6.5, network: '4G' });
    product.addVariant(variant(), now);
    product.publish(phone, now);
    product.publish(phone, now);
    expect(product.snapshot.status).toBe('published');
    expect(product.pullEvents().map((e) => e.type)).toEqual(['ProductPublished']);
  });

  it('re-checks attributes on publish when the category has changed', () => {
    const product = make({ screen_size: 6.5, network: '4G' });
    product.addVariant(variant(), now);
    const stricter = parseAttributeSchema([
      ...phone,
      { key: 'battery', label: 'Battery', type: 'number', required: true },
    ]);
    expect(() => product.publish(stricter, now)).toThrow('Battery');
  });

  it('keeps a published product complete when edited', () => {
    const product = make({ screen_size: 6.5, network: '4G' });
    product.addVariant(variant(), now);
    product.publish(phone, now);
    const details = { name: 'Tecno Spark 20', description: 'A phone', brandId: null, attributes: { screen_size: 6.5 } };
    expect(() => product.update(details, phone, now)).toThrow('Network');
  });

  it('normalizes SKUs and rejects duplicates and bad values', () => {
    const product = make();
    expect(product.addVariant(variant('ts20-blk'), now).sku).toBe('TS20-BLK');
    expect(() => product.addVariant(variant('TS20-BLK'), now)).toThrow('already');
    expect(() => product.addVariant({ ...variant('X1'), weightGrams: 0 }, now)).toThrow('Weight');
    expect(() => product.addVariant({ ...variant('X2'), weightGrams: 1.5 }, now)).toThrow('Weight');
    expect(() => product.addVariant(variant('bad sku'), now)).toThrow('SKU');
  });

  it('archives and can be published again', () => {
    const product = make({ screen_size: 6.5, network: '4G' });
    product.addVariant(variant(), now);
    product.publish(phone, now);
    product.archive(now);
    product.publish(phone, now);
    expect(product.pullEvents().map((e) => e.type)).toEqual(['ProductPublished', 'ProductArchived', 'ProductPublished']);
  });

  it.each([['', 'catalogue'], ['!!!', 'catalogue'], ['Ọ̀ṣun Gèlè', 'osun-gele']])('slugifies %j', (input, expected) => {
    if (expected === 'catalogue') expect(() => toSlug(input)).toThrow(DomainError);
    else expect(toSlug(input)).toBe(expected);
  });
});
