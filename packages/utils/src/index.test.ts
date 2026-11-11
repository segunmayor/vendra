import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatMoney, nairaToKobo } from './index.ts';

test('formats naira with separators', () => {
  assert.equal(formatMoney('1500000', 'NGN'), '₦15,000.00');
});

test('formats amounts below one naira', () => {
  assert.equal(formatMoney('5', 'NGN'), '₦0.05');
  assert.equal(formatMoney('0', 'NGN'), '₦0.00');
});

test('stays exact beyond float precision', () => {
  assert.equal(formatMoney('900719925474099312', 'NGN'), '₦9,007,199,254,740,993.12');
});

test('formats negatives and unknown currencies', () => {
  assert.equal(formatMoney('-150', 'NGN'), '-₦1.50');
  assert.equal(formatMoney('150', 'USD'), 'USD 1.50');
});

test('rejects non-integer input', () => {
  assert.throws(() => formatMoney('1.5', 'NGN'));
});

test('converts typed naira to exact kobo', () => {
  assert.equal(nairaToKobo('15000'), '1500000');
  assert.equal(nairaToKobo('₦15,000.5'), '1500050');
  assert.equal(nairaToKobo('0.05'), '5');
  assert.equal(nairaToKobo(' 1,234,567.89 '), '123456789');
  assert.equal(nairaToKobo('9999999999999.99'), '999999999999999');
});

test('rejects anything that is not a plain naira amount', () => {
  for (const bad of ['', 'abc', '1.234', '-5', '1e5', '15,00', '1,,000', '12.', '.5', '10000000000000']) {
    assert.equal(nairaToKobo(bad), null, bad);
  }
});
