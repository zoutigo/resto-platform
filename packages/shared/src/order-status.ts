export const ORDER_STATUSES = [
  'DRAFT',
  'PENDING_PREP',
  'IN_PREP',
  'PARTIALLY_READY',
  'READY',
  'PARTIALLY_SERVED',
  'SERVED',
  'CANCELLED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Les statuts n'avancent que dans ce sens (sauf annulation). */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  DRAFT: ['PENDING_PREP', 'CANCELLED'],
  PENDING_PREP: ['IN_PREP', 'CANCELLED'],
  IN_PREP: ['PARTIALLY_READY', 'READY', 'CANCELLED'],
  PARTIALLY_READY: ['READY', 'PARTIALLY_SERVED', 'CANCELLED'],
  READY: ['PARTIALLY_SERVED', 'SERVED'],
  PARTIALLY_SERVED: ['SERVED'],
  SERVED: [],
  CANCELLED: [],
};

export const canTransition = (from: OrderStatus, to: OrderStatus): boolean =>
  TRANSITIONS[from].includes(to);
