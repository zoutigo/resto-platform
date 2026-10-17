import { ApiError } from '@resto/shared';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notify } from '../feedback/notify';
import { apiError, fakeApi, meResponse, renderWithProviders, session, user } from '../test/render';
import { LoginForm } from './login-form';

beforeEach(() => {
  vi.spyOn(notify, 'success').mockReturnValue(1);
  vi.spyOn(notify, 'error').mockReturnValue(1);
  vi.spyOn(notify, 'info').mockReturnValue(1);
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function fillPhoneLogin(
  events: ReturnType<typeof renderWithProviders>['events'],
  phone = '677 12 34 56',
  pin = '483920',
) {
  await events.type(screen.getByLabelText('Numéro de téléphone'), phone);
  await events.type(screen.getByLabelText('Code PIN (6 chiffres)'), pin);
}

describe('LoginForm — téléphone + PIN', () => {
  it('envoie le numéro normalisé, charge le profil, annonce par un toast et redirige', async () => {
    const api = fakeApi();
    api.loginWithPhone.mockResolvedValue({ user, ...session });
    const onSuccess = vi.fn();
    const { events } = renderWithProviders(<LoginForm onSuccess={onSuccess} />, { api });

    await fillPhoneLogin(events);
    await events.click(screen.getByRole('button', { name: 'Se connecter' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(api.loginWithPhone).toHaveBeenCalledWith({ phone: '+237677123456', pin: '483920' });
    expect(api.me).toHaveBeenCalled();
    expect(notify.success).toHaveBeenCalledWith('Connexion réussie');
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ user }));
  });

  it('affiche les erreurs de validation traduites sans appeler l’API', async () => {
    const api = fakeApi();
    const { events } = renderWithProviders(<LoginForm onSuccess={vi.fn()} />, { api });
    await events.type(screen.getByLabelText('Numéro de téléphone'), '12345');
    await events.type(screen.getByLabelText('Code PIN (6 chiffres)'), '12');
    await events.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect(await screen.findByText(/Numéro invalide/)).toBeInTheDocument();
    expect(
      await screen.findByText('Le PIN doit contenir exactement 6 chiffres.'),
    ).toBeInTheDocument();
    expect(api.loginWithPhone).not.toHaveBeenCalled();
  });

  it('identifiants refusés : message général, toast, pas de redirection', async () => {
    const api = fakeApi();
    api.loginWithPhone.mockRejectedValue(new ApiError(401, 'auth.invalidCredentials'));
    const onSuccess = vi.fn();
    const { events } = renderWithProviders(<LoginForm onSuccess={onSuccess} />, { api });
    await fillPhoneLogin(events);
    await events.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect(await screen.findByTestId('form-error')).toHaveTextContent('Identifiants incorrects.');
    expect(notify.error).toHaveBeenCalledWith('Identifiants incorrects.');
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('trop de tentatives : indique le délai', async () => {
    const api = fakeApi();
    api.loginWithPhone.mockRejectedValue(new ApiError(429, 'auth.tooManyAttempts', [], 30));
    const { events } = renderWithProviders(<LoginForm onSuccess={vi.fn()} />, { api });
    await fillPhoneLogin(events);
    await events.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByTestId('form-error')).toHaveTextContent('Réessayez dans 30 s');
  });

  it('erreur serveur 500 et réseau coupé : message général + toast', async () => {
    const api = fakeApi();
    api.loginWithPhone
      .mockRejectedValueOnce(new ApiError(500, 'server.error'))
      .mockRejectedValueOnce(new ApiError(0, 'network.offline'));
    const { events } = renderWithProviders(<LoginForm onSuccess={vi.fn()} />, { api });
    await fillPhoneLogin(events);
    await events.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByTestId('form-error')).toHaveTextContent(
      'Le service rencontre un problème',
    );
    await events.click(screen.getByRole('button', { name: 'Se connecter' }));
    await waitFor(() =>
      expect(screen.getByTestId('form-error')).toHaveTextContent('Pas de connexion'),
    );
    expect(notify.error).toHaveBeenCalledTimes(2);
  });

  it('erreur de validation renvoyée par l’API : sous le champ concerné', async () => {
    const api = fakeApi();
    api.loginWithPhone.mockRejectedValue(
      new ApiError(400, 'validation.failed', [{ path: 'phone', message: 'phone.invalid' }]),
    );
    const { events } = renderWithProviders(<LoginForm onSuccess={vi.fn()} />, { api });
    await fillPhoneLogin(events);
    await events.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByText(/Numéro invalide/)).toBeInTheDocument();
  });

  it('désactive le bouton pendant l’envoi (pas de double soumission)', async () => {
    const api = fakeApi();
    let resolve!: (v: unknown) => void;
    api.loginWithPhone.mockReturnValue(new Promise((r) => (resolve = r)));
    const { events } = renderWithProviders(<LoginForm onSuccess={vi.fn()} />, { api });
    await fillPhoneLogin(events);
    await events.click(screen.getByRole('button', { name: 'Se connecter' }));
    const busy = await screen.findByRole('button', { name: 'Connexion…' });
    expect(busy).toBeDisabled();
    resolve({ user, ...session });
  });

  it('signale l’annulation d’une récupération en attente', async () => {
    const api = fakeApi();
    api.loginWithPhone.mockResolvedValue({ user, ...session, recoveryCancelled: true });
    const { events } = renderWithProviders(<LoginForm onSuccess={vi.fn()} />, { api });
    await fillPhoneLogin(events);
    await events.click(screen.getByRole('button', { name: 'Se connecter' }));
    await waitFor(() => expect(notify.info).toHaveBeenCalled());
  });

  it('le PIN est masqué et peut être affiché', async () => {
    const { events } = renderWithProviders(<LoginForm onSuccess={vi.fn()} />);
    const pin = screen.getByLabelText('Code PIN (6 chiffres)');
    await events.type(pin, '483920');
    expect(pin).toHaveAttribute('inputmode', 'numeric');
    const toggle = screen.getByRole('button', { name: 'Afficher' });
    await events.click(toggle);
    expect(screen.getByRole('button', { name: 'Masquer' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('refuse les lettres dans le PIN', async () => {
    const { events } = renderWithProviders(<LoginForm onSuccess={vi.fn()} />);
    const pin = screen.getByLabelText('Code PIN (6 chiffres)') as HTMLInputElement;
    await events.type(pin, 'ab12cd');
    expect(pin.value).toBe('12');
  });

  it('texte en anglais quand la langue est EN', async () => {
    renderWithProviders(<LoginForm onSuccess={vi.fn()} />, { locale: 'en' });
    expect(screen.getByLabelText('Phone number')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
  });
});

describe('LoginForm — email + mot de passe', () => {
  it('connecte par email', async () => {
    const api = fakeApi();
    api.loginWithEmail.mockResolvedValue({ user, ...session });
    const onSuccess = vi.fn();
    const { events } = renderWithProviders(<LoginForm onSuccess={onSuccess} />, { api });
    await events.click(screen.getByRole('tab', { name: 'Email' }));
    await events.type(screen.getByLabelText('Adresse email'), 'Awa@Gmail.com');
    await events.type(screen.getByLabelText('Mot de passe'), 'Soleil-2026');
    await events.click(screen.getByRole('button', { name: 'Se connecter' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(api.loginWithEmail).toHaveBeenCalledWith({
      email: 'awa@gmail.com',
      password: 'Soleil-2026',
    });
  });

  it('valide le format de l’adresse', async () => {
    const api = fakeApi();
    const { events } = renderWithProviders(<LoginForm onSuccess={vi.fn()} />, { api });
    await events.click(screen.getByRole('tab', { name: 'Email' }));
    await events.type(screen.getByLabelText('Adresse email'), 'pas-un-email');
    await events.type(screen.getByLabelText('Mot de passe'), 'x');
    await events.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByText('Adresse email invalide.')).toBeInTheDocument();
    expect(api.loginWithEmail).not.toHaveBeenCalled();
  });

  it('mauvais mot de passe : message général', async () => {
    const api = fakeApi();
    api.loginWithEmail.mockRejectedValue(apiError(401, 'auth.invalidCredentials'));
    const { events } = renderWithProviders(<LoginForm onSuccess={vi.fn()} />, { api });
    await events.click(screen.getByRole('tab', { name: 'Email' }));
    await events.type(screen.getByLabelText('Adresse email'), 'awa@gmail.com');
    await events.type(screen.getByLabelText('Mot de passe'), 'mauvais-mdp');
    await events.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByTestId('form-error')).toHaveTextContent('Identifiants incorrects.');
  });

  it('le mot de passe peut être affiché', async () => {
    const { events } = renderWithProviders(<LoginForm onSuccess={vi.fn()} />);
    await events.click(screen.getByRole('tab', { name: 'Email' }));
    const input = screen.getByLabelText('Mot de passe') as HTMLInputElement;
    expect(input.type).toBe('password');
    await events.click(screen.getByRole('button', { name: 'Afficher' }));
    expect(input.type).toBe('text');
  });
});

describe('LoginForm — Google', () => {
  it('n’affiche rien sans identifiant client', () => {
    renderWithProviders(<LoginForm onSuccess={vi.fn()} />);
    expect(screen.queryByTestId('google-button')).not.toBeInTheDocument();
  });

  it('affiche le bouton Google avec un identifiant client', () => {
    renderWithProviders(
      <LoginForm onSuccess={vi.fn()} googleClientId="abc.apps.googleusercontent.com" />,
    );
    expect(screen.getByTestId('google-button')).toBeInTheDocument();
  });
});

describe('profil chargé après connexion', () => {
  it('le contexte reflète l’utilisateur connecté', async () => {
    const api = fakeApi();
    api.loginWithPhone.mockResolvedValue({ user, ...session });
    api.me.mockResolvedValue(meResponse({ mustChangePin: true }));
    const onSuccess = vi.fn();
    const { events } = renderWithProviders(<LoginForm onSuccess={onSuccess} />, { api });
    await fillPhoneLogin(events);
    await events.click(screen.getByRole('button', { name: 'Se connecter' }));
    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ mustChangePin: true })),
    );
  });
});
