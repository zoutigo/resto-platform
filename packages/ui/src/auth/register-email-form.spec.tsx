import { ApiError } from '@resto/shared';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notify } from '../feedback/notify';
import { fakeApi, renderWithProviders, session, user } from '../test/render';
import { RegisterEmailForm } from './register-email-form';

beforeEach(() => {
  vi.spyOn(notify, 'success').mockReturnValue(1);
  vi.spyOn(notify, 'error').mockReturnValue(1);
});
afterEach(() => {
  vi.restoreAllMocks();
});

type Events = ReturnType<typeof renderWithProviders>['events'];

async function fill(
  events: Events,
  over: Partial<Record<'name' | 'email' | 'password' | 'confirm', string>> = {},
) {
  await events.type(screen.getByLabelText('Nom complet'), over.name ?? 'Awa Mbarga');
  await events.type(screen.getByLabelText('Adresse email'), over.email ?? 'Awa@Gmail.com');
  await events.type(screen.getByLabelText('Mot de passe'), over.password ?? 'Soleil-2026');
  await events.type(
    screen.getByLabelText('Confirmez le mot de passe'),
    over.confirm ?? 'Soleil-2026',
  );
  await events.click(screen.getByRole('button', { name: 'Recevoir un code' }));
}

describe('RegisterEmailForm', () => {
  it('envoie les données puis demande le code reçu par email', async () => {
    const api = fakeApi();
    api.registerWithEmail.mockResolvedValue({ sent: true });
    const { events } = renderWithProviders(<RegisterEmailForm onDone={vi.fn()} />, { api });
    await fill(events);

    expect(
      await screen.findByText('Un code à 6 chiffres a été envoyé à awa@gmail.com.'),
    ).toBeInTheDocument();
    expect(api.registerWithEmail).toHaveBeenCalledWith({
      name: 'Awa Mbarga',
      email: 'awa@gmail.com',
      password: 'Soleil-2026',
      passwordConfirm: 'Soleil-2026',
      locale: 'fr',
    });
  });

  it('valide le code et ouvre la session', async () => {
    const api = fakeApi();
    api.registerWithEmail.mockResolvedValue({ sent: true });
    api.verifyRegistrationCode.mockResolvedValue({ user, ...session });
    const onDone = vi.fn();
    const { events } = renderWithProviders(<RegisterEmailForm onDone={onDone} />, { api });
    await fill(events);
    await events.type(await screen.findByLabelText('Code reçu par email'), '482915');
    await events.click(screen.getByRole('button', { name: 'Valider le code' }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.verifyRegistrationCode).toHaveBeenCalledWith({
      email: 'awa@gmail.com',
      code: '482915',
    });
    expect(notify.success).toHaveBeenCalledWith('Compte créé');
  });

  it('code incorrect : message général, on reste sur la saisie', async () => {
    const api = fakeApi();
    api.registerWithEmail.mockResolvedValue({ sent: true });
    api.verifyRegistrationCode.mockRejectedValue(new ApiError(400, 'emailCode.invalid'));
    const onDone = vi.fn();
    const { events } = renderWithProviders(<RegisterEmailForm onDone={onDone} />, { api });
    await fill(events);
    await events.type(await screen.findByLabelText('Code reçu par email'), '000000');
    await events.click(screen.getByRole('button', { name: 'Valider le code' }));
    expect(await screen.findByTestId('form-error')).toHaveTextContent('Code incorrect ou expiré.');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('exige 6 chiffres avant d’appeler l’API', async () => {
    const api = fakeApi();
    api.registerWithEmail.mockResolvedValue({ sent: true });
    const { events } = renderWithProviders(<RegisterEmailForm onDone={vi.fn()} />, { api });
    await fill(events);
    await events.type(await screen.findByLabelText('Code reçu par email'), '48');
    await events.click(screen.getByRole('button', { name: 'Valider le code' }));
    expect(await screen.findByText('Code incorrect ou expiré.')).toBeInTheDocument();
    expect(api.verifyRegistrationCode).not.toHaveBeenCalled();
  });

  it('permet de renvoyer le code et de changer d’adresse', async () => {
    const api = fakeApi();
    api.registerWithEmail.mockResolvedValue({ sent: true });
    api.resendRegistrationCode.mockResolvedValue({ sent: true });
    const { events } = renderWithProviders(<RegisterEmailForm onDone={vi.fn()} />, { api });
    await fill(events);
    await events.click(await screen.findByRole('button', { name: 'Renvoyer le code' }));
    await waitFor(() =>
      expect(api.resendRegistrationCode).toHaveBeenCalledWith({
        email: 'awa@gmail.com',
        locale: 'fr',
      }),
    );
    expect(notify.success).toHaveBeenCalledWith('Un nouveau code a été envoyé');

    await events.click(screen.getByRole('button', { name: 'Changer d’adresse' }));
    expect(await screen.findByLabelText('Adresse email')).toBeInTheDocument();
  });

  it.each([
    ['adresse invalide', { email: 'pas-un-email' }, 'Adresse email invalide.'],
    [
      'mot de passe faible',
      { password: 'password', confirm: 'password' },
      'Mot de passe trop courant. Choisissez-en un moins prévisible.',
    ],
    ['mot de passe court', { password: 'abc', confirm: 'abc' }, 'Au moins 8 caractères.'],
    [
      'confirmation différente',
      { confirm: 'Autre-mdp-1' },
      'Les deux mots de passe ne sont pas identiques.',
    ],
  ])('refuse : %s', async (_label, over, message) => {
    const api = fakeApi();
    const { events } = renderWithProviders(<RegisterEmailForm onDone={vi.fn()} />, { api });
    await fill(events, over);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(api.registerWithEmail).not.toHaveBeenCalled();
  });

  it('adresse déjà utilisée : message général', async () => {
    const api = fakeApi();
    api.registerWithEmail.mockRejectedValue(new ApiError(409, 'auth.emailTaken'));
    const { events } = renderWithProviders(<RegisterEmailForm onDone={vi.fn()} />, { api });
    await fill(events);
    expect(await screen.findByTestId('form-error')).toHaveTextContent(
      'Cette adresse est déjà utilisée.',
    );
  });

  it('envoi d’emails indisponible (503) : message clair', async () => {
    const api = fakeApi();
    api.registerWithEmail.mockRejectedValue(new ApiError(503, 'email.notConfigured'));
    const { events } = renderWithProviders(<RegisterEmailForm onDone={vi.fn()} />, { api });
    await fill(events);
    expect(await screen.findByTestId('form-error')).toHaveTextContent(
      'L’envoi d’emails n’est pas disponible',
    );
  });

  it('transmet la langue anglaise à l’API', async () => {
    const api = fakeApi();
    api.registerWithEmail.mockResolvedValue({ sent: true });
    const { events } = renderWithProviders(<RegisterEmailForm onDone={vi.fn()} />, {
      api,
      locale: 'en',
    });
    await events.type(screen.getByLabelText('Full name'), 'Awa Mbarga');
    await events.type(screen.getByLabelText('Email address'), 'awa@gmail.com');
    await events.type(screen.getByLabelText('Password'), 'Soleil-2026');
    await events.type(screen.getByLabelText('Confirm password'), 'Soleil-2026');
    await events.click(screen.getByRole('button', { name: 'Get a code' }));
    await waitFor(() =>
      expect(api.registerWithEmail).toHaveBeenCalledWith(expect.objectContaining({ locale: 'en' })),
    );
  });
});
