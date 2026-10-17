import { ApiError } from '@resto/shared';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createTranslator } from '../i18n';
import { I18nProvider } from '../i18n';
import { ROOT_ERROR, handleSubmitError } from './handle-submit-error';
import { notify } from './notify';
import { useZodForm } from './zod-form';

const translator = createTranslator('fr');

function fakeForm(values: Record<string, unknown>) {
  return { getValues: () => values, setError: vi.fn() };
}

beforeEach(() => {
  vi.spyOn(notify, 'error').mockReturnValue(1);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleSubmitError', () => {
  it('place les erreurs de validation sous les champs et annonce par un toast', () => {
    const form = fakeForm({ phone: '', pin: '' });
    const error = new ApiError(400, 'validation.failed', [
      { path: 'pin', message: 'pin.weak' },
      { path: 'phone', message: 'phone.invalid' },
    ]);
    const message = handleSubmitError(error, { form, translator });
    expect(form.setError).toHaveBeenCalledWith('pin', {
      type: 'server',
      message: translator.tError('pin.weak'),
    });
    expect(form.setError).toHaveBeenCalledWith('phone', {
      type: 'server',
      message: translator.tError('phone.invalid'),
    });
    expect(form.setError).toHaveBeenCalledTimes(2);
    expect(message).toBe(translator.tError('validation.failed'));
    expect(notify.error).toHaveBeenCalledWith(message);
  });

  it('un champ inconnu du formulaire devient un message général', () => {
    const form = fakeForm({ phone: '' });
    handleSubmitError(
      new ApiError(400, 'validation.failed', [
        { path: 'recoveryAnswers.0.answer', message: 'answer.tooShort' },
      ]),
      {
        form,
        translator,
      },
    );
    expect(form.setError).toHaveBeenCalledWith(ROOT_ERROR, {
      type: 'server',
      message: translator.tError('validation.failed'),
    });
  });

  it('les champs imbriqués existants sont ciblés par leur chemin complet', () => {
    const form = fakeForm({ birthDate: { day: '', month: '', year: '' } });
    handleSubmitError(
      new ApiError(400, 'validation.failed', [{ path: 'birthDate', message: 'birthDate.invalid' }]),
      {
        form,
        translator,
      },
    );
    expect(form.setError).toHaveBeenCalledWith(
      'birthDate',
      expect.objectContaining({ type: 'server' }),
    );
  });

  it.each([
    [
      'identifiants incorrects',
      new ApiError(401, 'auth.invalidCredentials'),
      'Identifiants incorrects.',
    ],
    ['numéro déjà pris', new ApiError(409, 'auth.phoneTaken'), 'Ce numéro est déjà utilisé.'],
    [
      'erreur serveur',
      new ApiError(500, 'server.error'),
      'Le service rencontre un problème. Réessayez dans un instant.',
    ],
    [
      'réseau coupé',
      new ApiError(0, 'network.offline'),
      'Pas de connexion. Vérifiez votre réseau puis réessayez.',
    ],
    ['erreur inattendue', new Error('boom'), 'Une erreur est survenue. Réessayez.'],
    ['clé inconnue', new ApiError(418, 'cle.inconnue'), 'Une erreur est survenue. Réessayez.'],
  ])('message général + toast : %s', (_label, error, expected) => {
    const form = fakeForm({});
    const message = handleSubmitError(error, { form, translator });
    expect(message).toBe(expected);
    expect(form.setError).toHaveBeenCalledWith(ROOT_ERROR, { type: 'server', message: expected });
    expect(notify.error).toHaveBeenCalledWith(expected);
  });

  it('insère le délai d’un 429', () => {
    const form = fakeForm({});
    const message = handleSubmitError(new ApiError(429, 'auth.tooManyAttempts', [], 42), {
      form,
      translator,
    });
    expect(message).toContain('42 s');
  });

  it('fonctionne sans formulaire (toast seulement)', () => {
    expect(handleSubmitError(new ApiError(500, 'server.error'), { translator })).toContain(
      'problème',
    );
    expect(notify.error).toHaveBeenCalledOnce();
  });

  it('traduit dans la langue courante', () => {
    const en = createTranslator('en');
    expect(
      handleSubmitError(new ApiError(401, 'auth.invalidCredentials'), { translator: en }),
    ).toBe('Wrong credentials.');
  });
});

describe('useZodForm', () => {
  const schema = z.object({
    pin: z.string().regex(/^\d{6}$/, 'pin.format'),
    name: z.string().min(2, 'name.tooShort'),
  });

  it('traduit les messages du schéma dans la langue courante', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <I18nProvider locale="en">{children}</I18nProvider>
    );
    const { result } = renderHook(
      () => {
        const form = useZodForm(schema, { pin: '', name: '' });
        return { form, errors: form.formState.errors };
      },
      { wrapper },
    );
    await act(() => result.current.form.trigger());
    expect(result.current.errors.pin?.message).toBe('The PIN must be exactly 6 digits.');
    expect(result.current.errors.name?.message).toBe('Enter at least 2 characters.');
  });

  it('ne signale rien quand les valeurs sont valides', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <I18nProvider locale="fr">{children}</I18nProvider>
    );
    const { result } = renderHook(() => useZodForm(schema, { pin: '483920', name: 'Awa' }), {
      wrapper,
    });
    expect(await result.current.trigger()).toBe(true);
    expect(result.current.formState.errors).toEqual({});
  });
});
