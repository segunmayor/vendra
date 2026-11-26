import { readCsvSource, decodeText } from './csv-source';
import { buildDrafts, nairaToMinor, toHandle } from './drafts';

const HEADER = 'handle,name,description,category,brand,status,images,sku,option1_name,option1_value,price,sale_price,discount_percent,weight_grams,stock,warehouse,attr:screen_size';

function drafts(lines: string[], maxImages = 8) {
  const source = readCsvSource([HEADER, ...lines].join('\n'), 100);
  expect(source.errors).toEqual([]);
  return buildDrafts(source.records, { maxImages });
}

describe('nairaToMinor', () => {
  it.each([
    ['15000', 1_500_000n], ['15,000.50', 1_500_050n], ['₦ 2,500', 250_000n], ['NGN 99.5', 9_950n], ['N1200', 120_000n],
  ])('reads %s', (raw, minor) => {
    expect(nairaToMinor(raw)).toBe(minor);
  });

  it.each(['', 'abc', '12.345', '-5', '1e5'])('rejects %s', (raw) => {
    expect(nairaToMinor(raw)).toBeNull();
  });
});

describe('toHandle', () => {
  it('matches the catalogue slug rule', () => {
    expect(toHandle('  Café Noir — 250g!! ')).toBe('cafe-noir-250g');
  });
});

describe('readCsvSource', () => {
  it('maps aliases and reports unknown and missing columns', () => {
    const source = readCsvSource('Title,Category,SKU,Price,Weight (g),Colour code\nA,B,C,1,2,x', 10);
    expect(source.errors[0]?.message).toContain('Missing required columns: weight_grams');
    const ok = readCsvSource('Title,Category,Product Code,Price,weight-grams,Mystery\nA,B,C,1,2,x', 10);
    expect(ok.errors).toEqual([]);
    expect(ok.records[0]?.values).toMatchObject({ name: 'A', sku: 'C', weight_grams: '2' });
    expect(ok.warnings[0]?.message).toContain('Mystery');
  });

  it('rejects two columns meaning the same thing', () => {
    expect(readCsvSource('name,title,category,sku,price,weight_grams\n', 10).errors[0]?.message).toContain('both mean name');
  });

  it('refuses a file over the row limit', () => {
    const rows = Array.from({ length: 4 }, (_, i) => `P${i},Cat,SKU${i},100,1`);
    expect(readCsvSource(['name,category,sku,price,weight_grams', ...rows].join('\n'), 3).errors[0]?.message).toContain('more than 3 rows');
  });
});

describe('decodeText', () => {
  it('falls back to Windows text for non-UTF-8 files', () => {
    const result = decodeText(new Uint8Array([0x43, 0x61, 0x66, 0xe9]));
    expect(result.text).toBe('Café');
    expect(result.warning).toContain('UTF-8');
  });
});

describe('buildDrafts', () => {
  it('groups rows by handle into one product with variants', () => {
    const { drafts: [shirt] } = drafts([
      'ankara-shirt,Ankara Shirt,Cotton,Men,Adire,,https://a.example/1.jpg,SHIRT-M,Size,M,12000,,,250,5,,',
      'ankara-shirt,,,,,,,SHIRT-L,Size,L,12000,,,260,0,,',
    ]);
    expect(shirt).toMatchObject({ handle: 'ankara-shirt', name: 'Ankara Shirt', category: 'Men', brand: 'Adire', status: 'published', errors: [] });
    expect(shirt?.variants.map((v) => [v.sku, v.options, v.stock])).toEqual([['SHIRT-M', { Size: 'M' }, 5], ['SHIRT-L', { Size: 'L' }, 0]]);
    expect(shirt?.lines).toEqual([2, 3]);
  });

  it('uses the name as the handle when none is given', () => {
    expect(drafts([',Black Soap,,Beauty,,,,SOAP-1,,,1500,,,150,,,']).drafts[0]?.handle).toBe('black-soap');
  });

  it('turns a sale price into a discount', () => {
    const variant = drafts(['p,Phone,,Phones,,,,PH-1,,,215000,185000,,450,,,']).drafts[0]?.variants[0];
    expect(variant).toMatchObject({ priceMinor: '18500000', compareAtMinor: '21500000' });
  });

  it('turns a percentage into a discount rounded to whole naira', () => {
    const variant = drafts(['p,Phone,,Phones,,,,PH-1,,,9999,,15%,450,,,']).drafts[0]?.variants[0];
    expect(variant).toMatchObject({ priceMinor: '849900', compareAtMinor: '999900' });
  });

  it('reports each bad value against its row and column', () => {
    const { drafts: [bad] } = drafts(['p,X,,Phones,,maybe,,bad sku,,,free,,,-1,lots,,']);
    expect(bad?.errors.map((e) => [e.line, e.field])).toEqual(
      expect.arrayContaining([[2, 'name'], [2, 'status'], [2, 'sku'], [2, 'price'], [2, 'weight_grams'], [2, 'stock']]),
    );
  });

  it('rejects a sale price that is not lower, and both kinds of discount at once', () => {
    expect(drafts(['p,Phone,,Phones,,,,PH-1,,,100,100,,1,,,']).drafts[0]?.errors[0]?.field).toBe('sale_price');
    expect(drafts(['p,Phone,,Phones,,,,PH-1,,,100,90,10,1,,,']).drafts[0]?.errors[0]?.message).toContain('not both');
  });

  it('flags a product value that changes between rows', () => {
    const { drafts: [product] } = drafts(['p,Phone,,Phones,,,,PH-1,Size,S,100,,,1,,,', 'p,Fone,,Phones,,,,PH-2,Size,M,100,,,1,,,']);
    expect(product?.errors).toEqual([expect.objectContaining({ line: 3, field: 'name', message: expect.stringContaining('row 2') })]);
  });

  it('needs options to tell variants apart, and refuses repeats', () => {
    expect(drafts(['p,Phone,,Phones,,,,PH-1,,,100,,,1,,,', 'p,,,,,,,PH-2,,,100,,,1,,,']).drafts[0]?.errors[0]?.field).toBe('option1_name');
    expect(drafts(['p,Phone,,Phones,,,,PH-1,Size,M,100,,,1,,,', 'p,,,,,,,PH-2,size,m,100,,,1,,,']).drafts[0]?.errors[0]?.message).toContain('Same options as row 2');
  });

  it('refuses a SKU used twice in the file, even on different products', () => {
    const result = drafts(['a,Alpha,,Phones,,,,DUP-1,,,100,,,1,,,', 'b,Beta,,Phones,,,,dup-1,,,100,,,1,,,']);
    expect(result.drafts[1]?.errors[0]?.message).toContain('also on row 2');
  });

  it('splits photo addresses and keeps only the allowed number', () => {
    const { drafts: [product] } = drafts(['p,Phone,,Phones,,,"https://x.example/1.jpg | https://x.example/2.jpg\nhttps://x.example/3.jpg",PH-1,,,100,,,1,,,'], 2);
    expect(product?.images).toEqual(['https://x.example/1.jpg', 'https://x.example/2.jpg']);
    expect(product?.warnings[0]?.message).toContain('first 2 photos');
  });

  it('reads category attributes from attr: columns', () => {
    expect(drafts(['p,Phone,,Phones,,,,PH-1,,,100,,,1,,,6.5']).drafts[0]?.attributes).toEqual({ screen_size: '6.5' });
  });
});
