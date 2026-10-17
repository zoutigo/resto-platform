import { z } from 'zod';
import { phoneSchema } from './phone.js';
import { newPinSchema, pinFormatSchema } from './pin.js';
import { MIN_RECOVERY_ANSWERS, birthDateSchema, recoveryAnswersSchema } from './recovery.js';

const nameSchema = z.string().trim().min(2, 'name.tooShort').max(60, 'name.tooLong');

/** Un PIN égal aux six derniers chiffres du téléphone se devine trop facilement. */
const pinIsNotPhone = (v: { phone: string; pin: string }) => !v.phone.endsWith(v.pin);

const phonePinFields = {
  phone: phoneSchema,
  pin: newPinSchema,
  pinConfirm: pinFormatSchema,
};

const withPinChecks = <T extends z.ZodType<{ phone: string; pin: string; pinConfirm: string }>>(
  schema: T,
) =>
  schema
    .refine((v) => v.pin === v.pinConfirm, { path: ['pinConfirm'], message: 'pin.mismatch' })
    .refine(pinIsNotPhone, { path: ['pin'], message: 'pin.weak' });

/** Inscription d'un client sur la vitrine (téléphone + PIN). */
export const registerCustomerSchema = withPinChecks(
  z.object({
    name: nameSchema,
    ...phonePinFields,
    birthDate: birthDateSchema(),
    recoveryAnswers: recoveryAnswersSchema(MIN_RECOVERY_ANSWERS.customer),
  }),
);
export type RegisterCustomerInput = z.input<typeof registerCustomerSchema>;
export type RegisterCustomer = z.output<typeof registerCustomerSchema>;

/** Inscription d'un propriétaire sur le back-office (deux réponses secrètes). */
export const registerOwnerSchema = withPinChecks(
  z.object({
    firstName: nameSchema,
    lastName: nameSchema,
    ...phonePinFields,
    birthDate: birthDateSchema(),
    recoveryAnswers: recoveryAnswersSchema(MIN_RECOVERY_ANSWERS.owner),
  }),
);
export type RegisterOwnerInput = z.input<typeof registerOwnerSchema>;
export type RegisterOwner = z.output<typeof registerOwnerSchema>;

/** Connexion : le format seul est vérifié, jamais la solidité du PIN. */
export const loginPhoneSchema = z.object({
  phone: phoneSchema,
  pin: pinFormatSchema,
});
export type LoginPhoneInput = z.input<typeof loginPhoneSchema>;
export type LoginPhone = z.output<typeof loginPhoneSchema>;

/** Changement de PIN connecté : l'ancien est exigé, le nouveau doit être solide et différent. */
export const changePinSchema = z
  .object({
    currentPin: pinFormatSchema,
    newPin: newPinSchema,
    newPinConfirm: pinFormatSchema,
  })
  .refine((v) => v.newPin === v.newPinConfirm, {
    path: ['newPinConfirm'],
    message: 'pin.mismatch',
  })
  .refine((v) => v.newPin !== v.currentPin, { path: ['newPin'], message: 'pin.unchanged' });
export type ChangePinInput = z.input<typeof changePinSchema>;
