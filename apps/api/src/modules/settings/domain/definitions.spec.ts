import { isSettingKey, parseValue, SETTINGS } from './definitions';

describe('setting definitions', () => {
  it('have defaults that pass their own validation', () => {
    for (const key of Object.keys(SETTINGS)) {
      if (!isSettingKey(key)) throw new Error(key);
      const definition = SETTINGS[key];
      expect(parseValue(key, definition.default)).toEqual(definition.default);
    }
  });

  it('enforce ranges and whole numbers', () => {
    expect(parseValue('shopping.holdMinutes', 30)).toBe(30);
    expect(parseValue('shopping.holdMinutes', '30')).toBe(30);
    expect(() => parseValue('shopping.holdMinutes', 2)).toThrow('between 5 and 120');
    expect(() => parseValue('shopping.holdMinutes', 15.5)).toThrow('whole number');
    expect(() => parseValue('shopping.holdMinutes', 'soon')).toThrow('enter a number');
    expect(parseValue('search.typoTolerance', 0.45)).toBe(0.45);
  });

  it('normalise phones and URLs, and allow optional blanks', () => {
    expect(parseValue('store.supportPhone', '0803 123 4567')).toBe('+2348031234567');
    expect(parseValue('store.supportPhone', '')).toBe('');
    expect(parseValue('payments.storefrontUrl', 'https://vendra.ng/')).toBe('https://vendra.ng');
    expect(() => parseValue('payments.storefrontUrl', 'javascript:alert(1)')).toThrow('https://');
    expect(() => parseValue('payments.storefrontUrl', 'https://vendra.ng/?x=1')).toThrow('? or #');
    expect(() => parseValue('store.supportEmail', 'not-an-email')).toThrow('valid email');
  });

  it('refuse blank required text and overlong text', () => {
    expect(() => parseValue('store.name', '  ')).toThrow('cannot be blank');
    expect(() => parseValue('store.name', 'x'.repeat(61))).toThrow('at most 60');
  });

  it('recognise only known keys', () => {
    expect(isSettingKey('store.name')).toBe(true);
    expect(isSettingKey('toString')).toBe(false);
    expect(isSettingKey('__proto__')).toBe(false);
  });
});
