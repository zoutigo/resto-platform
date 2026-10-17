import { ApiError } from '@resto/shared';
import type { Translator } from '../i18n';
import { notify } from './notify';

/** Le strict nécessaire d'un formulaire react-hook-form (n'importe lequel est accepté). */
export interface FormLike {
  getValues: () => unknown;
  setError: (name: never, error: { type: string; message: string }) => void;
}

export interface SubmitErrorContext {
  /** Formulaire concerné : reçoit les erreurs de champ et le message général. */
  form?: FormLike;
  translator: Translator;
}

/** Message général du formulaire, affiché par `FormRootError`. */
export const ROOT_ERROR = 'root.server';

/**
 * Point unique de traitement d'un échec d'envoi de formulaire.
 * - Erreurs de validation de l'API : sous les champs concernés + toast.
 * - Toute autre erreur (identifiants, 429, 500, réseau coupé) : message général + toast.
 * Retourne le message général affiché (utile aux tests).
 */
export function handleSubmitError(
  error: unknown,
  { form, translator }: SubmitErrorContext,
): string {
  const { tError } = translator;

  if (error instanceof ApiError && error.isValidation && form) {
    const known = new Set(Object.keys(form.getValues() as Record<string, unknown>));
    let unplaced = false;
    for (const issue of error.issues) {
      if (known.has(issue.path.split('.')[0] ?? '')) {
        form.setError(issue.path as never, { type: 'server', message: tError(issue.message) });
      } else {
        unplaced = true;
      }
    }
    const message = tError('validation.failed');
    if (unplaced) form.setError(ROOT_ERROR as never, { type: 'server', message });
    notify.error(message);
    return message;
  }

  const key = error instanceof ApiError ? error.messageKey : 'unknown';
  const message = tError(
    key,
    error instanceof ApiError ? { seconds: error.retryAfter ?? 30 } : undefined,
  );
  form?.setError(ROOT_ERROR as never, { type: 'server', message });
  notify.error(message);
  return message;
}
