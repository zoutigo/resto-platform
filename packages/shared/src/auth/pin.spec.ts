import { describe, expect, it } from 'vitest';
import { isWeakPin, newPinSchema, pinFormatSchema } from './pin.js';

describe('isWeakPin', () => {
  it.each([
    '000000',
    '111111',
    '999999',
    '123456',
    '234567',
    '456789',
    '567890',
    '987654',
    '654321',
    '765432',
    '121212',
    '123123',
    '112233',
    '690690',
  ])('refuse %s', (pin) => {
    expect(isWeakPin(pin)).toBe(true);
  });

  it.each(['483920', '170695', '905817', '246810', '135791'])('accepte %s', (pin) => {
    expect(isWeakPin(pin)).toBe(false);
  });
});

describe('pinFormatSchema', () => {
  it('accepte 6 chiffres, même faibles (connexion)', () => {
    expect(pinFormatSchema.safeParse('123456').success).toBe(true);
  });

  it.each(['12345', '1234567', 'abcdef', '12 456', '', '12345a'])('refuse %s', (pin) => {
    expect(pinFormatSchema.safeParse(pin).success).toBe(false);
  });
});

describe('newPinSchema', () => {
  it('refuse un PIN trivial avec pin.weak', () => {
    const r = newPinSchema.safeParse('123456');
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('pin.weak');
  });

  it('accepte un PIN solide', () => {
    expect(newPinSchema.safeParse('483920').success).toBe(true);
  });
});
