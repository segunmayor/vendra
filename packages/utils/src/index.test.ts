import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatMoney } from './index.ts';

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
