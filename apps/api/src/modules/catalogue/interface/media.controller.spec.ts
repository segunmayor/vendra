import { parseRange } from './media.controller';

describe('byte ranges for product media', () => {
  const size = 10 * 1024 * 1024;

  it('reads closed, open-ended and suffix ranges', () => {
    expect(parseRange('bytes=0-99', size)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=100-', 1000)).toEqual({ start: 100, end: 999 });
    expect(parseRange('bytes=-200', 1000)).toEqual({ start: 800, end: 999 });
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
  });

  it('sends an open-ended range of a large file in 4 MB pieces', () => {
    expect(parseRange('bytes=0-', size)).toEqual({ start: 0, end: 4 * 1024 * 1024 - 1 });
  });

  it('answers the whole file for no range, several ranges or other units', () => {
    expect(parseRange(undefined, size)).toBeNull();
    expect(parseRange('bytes=0-1,5-6', size)).toBeNull();
    expect(parseRange('items=0-1', size)).toBeNull();
  });

  it('refuses ranges past the end', () => {
    expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=5-2', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 1000)).toBe('unsatisfiable');
  });
});
