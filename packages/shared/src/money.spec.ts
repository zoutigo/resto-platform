import { describe, expect, it } from 'vitest';
import { formatXAF } from './money';

// Intl insère des espaces insécables fines : on normalise pour comparer.
const flat = (s: string) => s.replace(/\s/g, ' ');

describe('formatXAF', () => {
  it('formate en FCFA avec séparateur de milliers', () => {
    expect(flat(formatXAF(2500))).toBe('2 500 FCFA');
    expect(flat(formatXAF(1250000))).toBe('1 250 000 FCFA');
  });

  it('arrondit : pas de décimales en XAF', () => {
    expect(flat(formatXAF(99.6))).toBe('100 FCFA');
  });
});
