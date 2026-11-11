import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emailSchema, nigerianPhoneSchema, passwordSchema } from './index.ts';

test('normalizes every accepted phone format', () => {
  for (const input of ['08031234567', '2348031234567', '+2348031234567', '0803 123 4567']) {
    assert.equal(nigerianPhoneSchema.parse(input), '+2348031234567');
  }
});

test('rejects invalid phone numbers', () => {
  for (const input of ['0803123456', '12345678901', '06031234567', 'abc']) {
    assert.equal(nigerianPhoneSchema.safeParse(input).success, false);
  }
});

test('validates email and passwords', () => {
  assert.equal(emailSchema.safeParse('not-an-email').success, false);
  assert.equal(passwordSchema.safeParse('short').success, false);
  assert.equal(passwordSchema.safeParse('long-enough-password').success, true);
});
