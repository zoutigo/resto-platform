import { describe, expect, it } from 'vitest';
import { ORDER_STATUSES, canTransition } from './order-status';

describe('canTransition', () => {
  it('suit le flux nominal DRAFT → … → SERVED', () => {
    expect(canTransition('DRAFT', 'PENDING_PREP')).toBe(true);
    expect(canTransition('PENDING_PREP', 'IN_PREP')).toBe(true);
    expect(canTransition('IN_PREP', 'READY')).toBe(true);
    expect(canTransition('READY', 'SERVED')).toBe(true);
  });

  it('refuse de revenir en arrière', () => {
    expect(canTransition('SERVED', 'READY')).toBe(false);
    expect(canTransition('IN_PREP', 'PENDING_PREP')).toBe(false);
  });

  it('autorise l’annulation tant que rien n’est prêt à servir', () => {
    for (const from of ['DRAFT', 'PENDING_PREP', 'IN_PREP', 'PARTIALLY_READY'] as const) {
      expect(canTransition(from, 'CANCELLED')).toBe(true);
    }
    expect(canTransition('READY', 'CANCELLED')).toBe(false);
  });

  it('SERVED et CANCELLED sont terminaux', () => {
    for (const to of ORDER_STATUSES) {
      expect(canTransition('SERVED', to)).toBe(false);
      expect(canTransition('CANCELLED', to)).toBe(false);
    }
  });
});
