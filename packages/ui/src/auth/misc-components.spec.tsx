import { ApiError } from '@resto/shared';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notify } from '../feedback/notify';
import { I18nProvider } from '../i18n';
import { fakeApi, meResponse, renderWithProviders, session, user } from '../test/render';
import { AccountPanel } from './account-panel';
import { ChangePinForm } from './change-pin-form';
import { GoogleButton } from './google-button';
import { AuthShell, LocaleSwitcher } from './layout';
import { RecoveryCodeScreen } from './recovery-code-screen';

beforeEach(() => {
  vi.spyOn(notify, 'success').mockReturnValue(1);
  vi.spyOn(notify, 'error').mockReturnValue(1);
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (window as { google?: unknown }).google;
  document.head.querySelectorAll('script').forEach((s) => s.remove());
});

describe('RecoveryCodeScreen', () => {
  it('affiche le code et ne laisse continuer qu’après confirmation', async () => {
    const onContinue = vi.fn();
    const { events } = renderWithProviders(
      <RecoveryCodeScreen code="ABCD-EFGH-JKMN" onContinue={onContinue} />,
    );
    expect(screen.getByTestId('recovery-code')).toHaveTextContent('ABCD-EFGH-JKMN');
    const button = screen.getByRole('button', { name: 'Continuer' });
    expect(button).toBeDisabled();
    await events.click(button);
    expect(onContinue).not.toHaveBeenCalled();
    await events.click(screen.getByLabelText('J’ai noté mon code de secours'));
    expect(button).toBeEnabled();
    await events.click(button);
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('copie le code dans le presse-papiers et l’annonce', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { events } = renderWithProviders(
      <RecoveryCodeScreen code="ABCD-EFGH-JKMN" onContinue={vi.fn()} />,
    );
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await events.click(screen.getByRole('button', { name: 'Copier' }));
    expect(writeText).toHaveBeenCalledWith('ABCD-EFGH-JKMN');
    expect(notify.success).toHaveBeenCalledWith('Code copié');
    expect(await screen.findByRole('button', { name: 'Copié' })).toBeInTheDocument();
  });

  it('reste utilisable si le presse-papiers est indisponible', async () => {
    const { events } = renderWithProviders(
      <RecoveryCodeScreen code="ABCD-EFGH-JKMN" onContinue={vi.fn()} />,
    );
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    await events.click(screen.getByRole('button', { name: 'Copier' }));
    expect(screen.getByTestId('recovery-code')).toBeInTheDocument();
    expect(notify.success).not.toHaveBeenCalled();
  });
});

describe('ChangePinForm', () => {
  async function fill(
    events: ReturnType<typeof renderWithProviders>['events'],
    current = '482915',
    next = '715204',
    confirm = next,
  ) {
    await events.type(screen.getByLabelText('PIN actuel'), current);
    await events.type(screen.getByLabelText('Nouveau PIN (6 chiffres)'), next);
    await events.type(screen.getByLabelText('Confirmez le nouveau PIN'), confirm);
    await events.click(screen.getByRole('button', { name: 'Changer mon PIN' }));
  }

  it('change le PIN, recharge le profil et annonce par un toast', async () => {
    const api = fakeApi();
    api.changePin.mockResolvedValue(session);
    const onDone = vi.fn();
    const { events } = renderWithProviders(<ChangePinForm onDone={onDone} />, { api });
    await fill(events);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.changePin).toHaveBeenCalledWith({
      currentPin: '482915',
      newPin: '715204',
      newPinConfirm: '715204',
    });
    expect(api.me).toHaveBeenCalled();
    expect(notify.success).toHaveBeenCalledWith('PIN modifié');
  });

  it.each([
    ['PIN faible', ['482915', '123456', '123456'], /trop facile à deviner/],
    [
      'confirmation différente',
      ['482915', '715204', '715205'],
      'Les deux PIN ne sont pas identiques.',
    ],
    ['même PIN', ['482915', '482915', '482915'], 'Le nouveau PIN doit être différent de l’actuel.'],
  ])('refuse : %s', async (_label, [current, next, confirm], message) => {
    const api = fakeApi();
    const { events } = renderWithProviders(<ChangePinForm onDone={vi.fn()} />, { api });
    await fill(events, current, next, confirm);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(api.changePin).not.toHaveBeenCalled();
  });

  it('mauvais PIN actuel : message général', async () => {
    const api = fakeApi();
    api.changePin.mockRejectedValue(new ApiError(401, 'auth.invalidCredentials'));
    const { events } = renderWithProviders(<ChangePinForm onDone={vi.fn()} />, { api });
    await fill(events);
    expect(await screen.findByTestId('form-error')).toHaveTextContent('Identifiants incorrects.');
  });
});

describe('AccountPanel', () => {
  it('affiche le profil et l’état de vérification', async () => {
    const api = fakeApi();
    api.restore.mockResolvedValue(
      meResponse({ user: { ...user, email: 'awa@gmail.com', emailVerified: true } }),
    );
    renderWithProviders(<AccountPanel onLoggedOut={vi.fn()} />, { api });
    expect(await screen.findByText('Awa Mbarga')).toBeInTheDocument();
    expect(screen.getByText('+237677123456')).toBeInTheDocument();
    expect(screen.getByText('non vérifié')).toBeInTheDocument();
    expect(screen.getByText('awa@gmail.com')).toBeInTheDocument();
    expect(screen.getByText('vérifié')).toBeInTheDocument();
  });

  it('alerte d’une récupération en cours et permet de l’annuler (« Ce n’est pas moi »)', async () => {
    const api = fakeApi();
    api.restore.mockResolvedValue(
      meResponse({ recoveryPending: { availableAt: '2026-10-19T10:00:00.000Z' } }),
    );
    api.cancelRecovery.mockResolvedValue({ cancelled: 1 });
    const { events } = renderWithProviders(<AccountPanel onLoggedOut={vi.fn()} />, { api });
    expect(await screen.findByTestId('recovery-alert')).toHaveTextContent(/19 octobre 2026/);
    api.me.mockResolvedValue(meResponse());
    await events.click(screen.getByRole('button', { name: 'Ce n’est pas moi' }));
    await waitFor(() => expect(api.cancelRecovery).toHaveBeenCalled());
    expect(notify.success).toHaveBeenCalledWith('Demande annulée');
    await waitFor(() => expect(screen.queryByTestId('recovery-alert')).not.toBeInTheDocument());
  });

  it('signale un compte restreint', async () => {
    const api = fakeApi();
    api.restore.mockResolvedValue(meResponse({ user: { ...user, restricted: true } }));
    renderWithProviders(<AccountPanel onLoggedOut={vi.fn()} />, { api });
    expect(await screen.findByText(/restreint pendant 48 h/)).toBeInTheDocument();
  });

  it('ajoute un email en deux temps (code reçu par email)', async () => {
    const api = fakeApi();
    api.restore.mockResolvedValue(meResponse());
    api.addEmail.mockResolvedValue({ sent: true });
    api.confirmEmail.mockResolvedValue({ user });
    const { events } = renderWithProviders(<AccountPanel onLoggedOut={vi.fn()} />, { api });
    await events.type(await screen.findByLabelText('Adresse email'), 'awa@gmail.com');
    await events.click(screen.getByRole('button', { name: 'Ajouter une adresse email' }));
    await events.type(await screen.findByLabelText('Code reçu par email'), '482915');
    await events.click(screen.getByRole('button', { name: 'Confirmer l’adresse' }));
    await waitFor(() =>
      expect(api.confirmEmail).toHaveBeenCalledWith({ email: 'awa@gmail.com', code: '482915' }),
    );
    expect(notify.success).toHaveBeenCalledWith('Adresse email ajoutée');
  });

  it('ajoute un numéro de téléphone à un compte email', async () => {
    const api = fakeApi();
    api.restore.mockResolvedValue(
      meResponse({ user: { ...user, phone: null, email: 'awa@gmail.com', emailVerified: true } }),
    );
    api.addPhone.mockResolvedValue({ user });
    const { events } = renderWithProviders(<AccountPanel onLoggedOut={vi.fn()} />, { api });
    await events.type(await screen.findByLabelText('Numéro de téléphone'), '677 12 34 56');
    await events.click(screen.getByRole('button', { name: 'Ajouter un numéro de téléphone' }));
    await waitFor(() => expect(api.addPhone).toHaveBeenCalledWith({ phone: '+237677123456' }));
  });

  it('numéro déjà pris : message général', async () => {
    const api = fakeApi();
    api.restore.mockResolvedValue(
      meResponse({ user: { ...user, phone: null, email: 'a@b.cm', emailVerified: true } }),
    );
    api.addPhone.mockRejectedValue(new ApiError(409, 'auth.phoneTaken'));
    const { events } = renderWithProviders(<AccountPanel onLoggedOut={vi.fn()} />, { api });
    await events.type(await screen.findByLabelText('Numéro de téléphone'), '677123456');
    await events.click(screen.getByRole('button', { name: 'Ajouter un numéro de téléphone' }));
    expect(await screen.findByTestId('form-error')).toHaveTextContent(
      'Ce numéro est déjà utilisé.',
    );
  });

  it('génère un nouveau code de secours après confirmation du PIN', async () => {
    const api = fakeApi();
    api.restore.mockResolvedValue(meResponse());
    api.regenerateRecoveryCode.mockResolvedValue({ recoveryCode: 'WXYZ-2345-6789' });
    const { events } = renderWithProviders(<AccountPanel onLoggedOut={vi.fn()} />, { api });
    await events.type(await screen.findByLabelText('PIN actuel'), '482915');
    await events.click(screen.getByRole('button', { name: 'Générer un nouveau code de secours' }));
    expect(await screen.findByTestId('recovery-code')).toHaveTextContent('WXYZ-2345-6789');
    expect(api.regenerateRecoveryCode).toHaveBeenCalledWith('482915');
  });

  it('se déconnecte et annonce le résultat', async () => {
    const api = fakeApi();
    api.restore.mockResolvedValue(meResponse());
    const onLoggedOut = vi.fn();
    const { events } = renderWithProviders(<AccountPanel onLoggedOut={onLoggedOut} />, { api });
    await events.click(await screen.findByRole('button', { name: 'Se déconnecter' }));
    await waitFor(() => expect(onLoggedOut).toHaveBeenCalled());
    expect(api.logout).toHaveBeenCalled();
    expect(notify.success).toHaveBeenCalledWith('Vous êtes déconnecté');
  });

  it('serveur injoignable : le dit et reste connecté (pas de fausse déconnexion)', async () => {
    const api = fakeApi();
    api.restore.mockResolvedValue(meResponse());
    api.logout.mockRejectedValue(new ApiError(0, 'network.offline'));
    const onLoggedOut = vi.fn();
    const { events } = renderWithProviders(<AccountPanel onLoggedOut={onLoggedOut} />, { api });
    await events.click(await screen.findByRole('button', { name: 'Se déconnecter' }));
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(expect.stringContaining('Pas de connexion')),
    );
    expect(onLoggedOut).not.toHaveBeenCalled();
    expect(screen.getByText('Awa Mbarga')).toBeInTheDocument();
  });
});

describe('GoogleButton', () => {
  function installGoogle() {
    const initialize = vi.fn();
    const renderButton = vi.fn();
    (window as unknown as { google: unknown }).google = {
      accounts: { id: { initialize, renderButton } },
    };
    return { initialize, renderButton };
  }

  it('n’affiche rien sans identifiant client', () => {
    const { container } = render(
      <I18nProvider locale="fr">
        <GoogleButton onCredential={vi.fn()} />
      </I18nProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('initialise Google Identity Services et transmet le jeton reçu', async () => {
    const { initialize, renderButton } = installGoogle();
    const onCredential = vi.fn();
    render(
      <I18nProvider locale="en">
        <GoogleButton clientId="abc.apps.googleusercontent.com" onCredential={onCredential} />
      </I18nProvider>,
    );
    await waitFor(() => expect(renderButton).toHaveBeenCalled());
    expect(initialize.mock.calls[0]?.[0].client_id).toBe('abc.apps.googleusercontent.com');
    expect(renderButton.mock.calls[0]?.[1]).toMatchObject({ locale: 'en', text: 'continue_with' });
    act(() => initialize.mock.calls[0]?.[0].callback({ credential: 'id-token-xyz' }));
    expect(onCredential).toHaveBeenCalledWith('id-token-xyz');
  });

  it('charge le script Google une seule fois quand il est absent', async () => {
    const { rerender } = render(
      <I18nProvider locale="fr">
        <GoogleButton clientId="abc" onCredential={vi.fn()} />
      </I18nProvider>,
    );
    rerender(
      <I18nProvider locale="fr">
        <GoogleButton clientId="abc" onCredential={vi.fn()} />
      </I18nProvider>,
    );
    expect(
      document.querySelectorAll('script[src="https://accounts.google.com/gsi/client"]'),
    ).toHaveLength(1);
  });
});

describe('AuthShell et LocaleSwitcher', () => {
  it('rend un titre de niveau 1 et son contenu', () => {
    render(
      <I18nProvider locale="fr">
        <AuthShell title="Connexion" subtitle="Sous-titre" footer={<a href="/x">Lien</a>}>
          <p>Contenu</p>
        </AuthShell>
      </I18nProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Connexion' })).toBeInTheDocument();
    expect(screen.getByText('Contenu')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lien' })).toBeInTheDocument();
  });

  it('propose FR/EN et signale la langue active', async () => {
    const onChange = vi.fn();
    render(
      <I18nProvider locale="fr">
        <LocaleSwitcher onChange={onChange} />
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { name: 'FR' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(onChange).toHaveBeenCalledWith('en');
  });
});
