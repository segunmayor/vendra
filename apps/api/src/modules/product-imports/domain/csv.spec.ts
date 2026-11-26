import { csvCell, csvLine, parseCsv } from './csv';

const parse = (text: string) => parseCsv(text, { maxRows: 100 });
const cells = (text: string) => parse(text).rows.map((row) => row.cells);

describe('parseCsv', () => {
  it('reads plain rows with LF or CRLF line ends', () => {
    expect(cells('a,b\n1,2\r\n3,4')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });

  it('strips a UTF-8 byte order mark', () => {
    expect(cells('﻿name,sku\nX,Y')[0]).toEqual(['name', 'sku']);
  });

  it('reads quoted fields with separators, doubled quotes and line breaks', () => {
    const result = parse('name,description\n"Shirt, blue","Line one\nLine ""two"""\nNext,row');
    expect(result.rows.map((row) => row.cells)).toEqual([
      ['name', 'description'],
      ['Shirt, blue', 'Line one\nLine "two"'],
      ['Next', 'row'],
    ]);
    expect(result.rows.map((row) => row.line)).toEqual([1, 2, 4]);
  });

  it('skips blank lines and rows of empty cells, keeping line numbers true', () => {
    const result = parse('a,b\n\n,,\n1,2\n');
    expect(result.rows.map((row) => [row.line, ...row.cells])).toEqual([[1, 'a', 'b'], [4, '1', '2']]);
  });

  it('detects semicolon and tab separators', () => {
    expect(parse('a;b\n1;2').separator).toBe(';');
    expect(cells('a;b\n"1;5";2')[1]).toEqual(['1;5', '2']);
    expect(cells('a\tb\n1\t2')[1]).toEqual(['1', '2']);
  });

  it('keeps empty trailing cells', () => {
    expect(cells('a,b,c\n1,,')[1]).toEqual(['1', '', '']);
  });

  it('reports an unclosed quote with its line', () => {
    expect(parse('a\n"open\nstill open').errors).toEqual([{ line: 2, message: expect.stringContaining('never closed') }]);
  });

  it('reports text after a closing quote', () => {
    expect(parse('a\n"x"y').errors[0]?.message).toContain('after a closing quote');
  });

  it('stops reading after the row limit', () => {
    expect(parseCsv('h\n1\n2\n3\n4\n5', { maxRows: 2 }).rows.length).toBe(4);
  });
});

describe('csvCell', () => {
  it('quotes separators and quotes', () => {
    expect(csvLine(['a,b', 'say "hi"', 3])).toBe('"a,b","say ""hi""",3');
  });

  it.each(['=SUM(A1)', '+234', '-1', '@cmd'])('defuses a formula in %s', (value) => {
    expect(csvCell(value).replace(/^"/, '')).toMatch(/^'/);
  });
});
