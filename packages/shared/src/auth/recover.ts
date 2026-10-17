import { z } from 'zod';
import { phoneSchema } from './phone.js';
import { newPinSchema, pinFormatSchema } from './pin.js';
import { birthDateSchema, recoveryAnswersSchema } from './recovery.js';

/** Même contrôle qu'à l'inscription : confirmation identique, PIN ≠ fin du téléphone. */
const withNewPinChecks = <
  T extends z.ZodType<{ phone: string; newPin: string; newPinConfirm: string }>,
>(
  schema: T,
) =>
  schema
    .refine((v) => v.newPin === v.newPinConfirm, {
      path: ['newPinConfirm'],
      message: 'pin.mismatch',
    })
    .refine((v) => !v.phone.endsWith(v.newPin), { path: ['newPin'], message: 'pin.weak' });

const newPinFields = { newPin: newPinSchema, newPinConfirm: pinFormatSchema };

/** Saisie tolérante du code de secours : casse, tirets et espaces ignorés côté serveur. */
export const recoveryCodeSchema = z
  .string()
  .trim()
  .min(12, 'recoveryCode.invalid')
  .max(20, 'recoveryCode.invalid');

export const recoverWithCodeSchema = withNewPinChecks(
  z.object({ phone: phoneSchema, recoveryCode: recoveryCodeSchema, ...newPinFields }),
);
export type RecoverWithCodeInput = z.input<typeof recoverWithCodeSchema>;
export type RecoverWithCode = z.output<typeof recoverWithCodeSchema>;

export const recoverWithQuestionsSchema = withNewPinChecks(
  z.object({
    phone: phoneSchema,
    birthDate: birthDateSchema(),
    recoveryAnswers: recoveryAnswersSchema(1),
    ...newPinFields,
  }),
);
export type RecoverWithQuestionsInput = z.input<typeof recoverWithQuestionsSchema>;
export type RecoverWithQuestions = z.output<typeof recoverWithQuestionsSchema>;

/** Fin d'une récupération différée : on prouve qu'on connaît le PIN choisi au départ. */
export const completeRecoverySchema = z.object({ phone: phoneSchema, newPin: pinFormatSchema });
export type CompleteRecoveryInput = z.input<typeof completeRecoverySchema>;
export type CompleteRecovery = z.output<typeof completeRecoverySchema>;

/** Régénération du code de secours : confirmée par le PIN actuel. */
export const regenerateRecoveryCodeSchema = z.object({ pin: pinFormatSchema });

/** Délais avant qu'une récupération par questions s'applique, selon les rôles du compte. */
export const RECOVERY_DELAY_HOURS = { managers: 48, otherStaff: 24, customer: 0 } as const;
