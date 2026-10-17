import { describe, expect, it } from 'vitest';
import { normalizePhone, phoneSchema } from './phone.js';

describe('normalizePhone', () => {
  it.each([
    ['677123456', '+237677123456'],
    ['6 77 12 34 56', '+237677123456'],
    ['6.77.12.34.56', '+237677123456'],
    ['+237 677 12 34 56', '+237677123456'],
    ['+237677123456', '+237677123456'],
    ['00237677123456', '+237677123456'],
    ['237677123456', '+237677123456'],
    ['(237) 655-123-456', '+237655123456'],
  ])('accepte et normalise %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    '',
    '67712345', // 8 chiffres
    '6771234567', // 10 chiffres
    '233677123456', // mauvais indicatif
    '+33612345678', // numéro français
    '222123456', // fixe, ne commence pas par 6
    '67712a456',
    '+23767712345',
  ])('refuse %s', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe('phoneSchema', () => {
  it('renvoie le numéro normalisé', () => {
    expect(phoneSchema.parse('  677 12 34 56 ')).toBe('+237677123456');
  });

  it('signale phone.invalid', () => {
    const r = phoneSchema.safeParse('12345');
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('phone.invalid');
  });
});
