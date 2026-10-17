import { z } from 'zod';

const COMMON_PINS = new Set([
  '123123',
  '121212',
  '112233',
  '123321',
  '111222',
  '654321',
  '159753',
  '696969',
  '520520',
]);

/** Suite de chiffres consécutifs croissants ou décroissants (123456, 987654, 456789…). */
const isSequence = (pin: string): boolean =>
  '01234567890'.includes(pin) || '09876543210'.includes(pin);

/** PIN trop facile à deviner : même chiffre, suite, motif répété ou liste noire. */
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1{5}$/.test(pin)) return true;
  if (isSequence(pin)) return true;
  if (/^(\d{2})\1\1$/.test(pin) || /^(\d{3})\1$/.test(pin)) return true;
  return COMMON_PINS.has(pin);
}

/** Format seul (connexion) : 6 chiffres, sans jugement sur la solidité. */
export const pinFormatSchema = z.string().regex(/^\d{6}$/, 'pin.format');

/** Création ou changement de PIN : format + refus des PIN triviaux. */
export const newPinSchema = pinFormatSchema.refine((pin) => !isWeakPin(pin), 'pin.weak');
