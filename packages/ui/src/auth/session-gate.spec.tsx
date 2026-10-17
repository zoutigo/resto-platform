import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fakeApi, meResponse, renderWithProviders } from '../test/render';
import { useAuth } from './auth-context';
import { GuestOnly, RequireAuth } from './session-gate';

/** Petit bouton qui simule la fin d'une inscription : la session s'ouvre pendant le parcours. */
function FinishSignIn() {
  const { signIn } = useAuth();
  return <button onClick={() => void signIn()}>ouvrir la session</button>;
}

describe('GuestOnly', () => {
  it('affiche la page à un visiteur non connecté', async () => {
    const navigate = vi.fn();
    renderWithProviders(
      <GuestOnly navigate={navigate}>
        <p>formulaire</p>
      </GuestOnly>,
    );
    expect(await screen.findByText('formulaire')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('renvoie ailleurs un utilisateur déjà connecté à l’ouverture', async () => {
    const api = fakeApi();
    api.restore.mockResolvedValue(meResponse());
    const navigate = vi.fn();
    renderWithProviders(
      <GuestOnly navigate={navigate} homePath="/accueil">
        <p>formulaire</p>
      </GuestOnly>,
      { api },
    );
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/accueil'));
    expect(screen.queryByText('formulaire')).not.toBeInTheDocument();
  });

  it('ne démonte PAS le parcours quand la session s’ouvre pendant l’inscription (le code de secours reste visible)', async () => {
    const api = fakeApi();
    const navigate = vi.fn();
    const { events } = renderWithProviders(
      <GuestOnly navigate={navigate}>
        <p>code de secours</p>
        <FinishSignIn />
      </GuestOnly>,
      { api },
    );
    await screen.findByText('code de secours');
    await events.click(screen.getByRole('button', { name: 'ouvrir la session' }));
    await vi.waitFor(() => expect(api.me).toHaveBeenCalled());
    expect(screen.getByText('code de secours')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('affiche un squelette accessible pendant le chargement de la session', () => {
    const api = fakeApi();
    api.restore.mockReturnValue(new Promise(() => undefined));
    renderWithProviders(
      <GuestOnly navigate={vi.fn()}>
        <p>formulaire</p>
      </GuestOnly>,
      { api },
    );
    expect(screen.getByLabelText('Chargement…')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('formulaire')).not.toBeInTheDocument();
  });
});

describe('RequireAuth', () => {
  it('renvoie un visiteur non connecté vers la connexion', async () => {
    const navigate = vi.fn();
    renderWithProviders(
      <RequireAuth navigate={navigate} pathname="/team">
        <p>privé</p>
      </RequireAuth>,
    );
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/login'));
    expect(screen.queryByText('privé')).not.toBeInTheDocument();
  });

  it('utilise le chemin de connexion fourni', async () => {
    const navigate = vi.fn();
    renderWithProviders(
      <RequireAuth navigate={navigate} pathname="/" loginPath="/connexion">
        <p>privé</p>
      </RequireAuth>,
    );
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/connexion'));
  });

  it('laisse passer un utilisateur connecté', async () => {
    const api = fakeApi();
    api.restore.mockResolvedValue(meResponse());
    const navigate = vi.fn();
    renderWithProviders(
      <RequireAuth navigate={navigate} pathname="/">
        <p>privé</p>
      </RequireAuth>,
      { api },
    );
    expect(await screen.findByText('privé')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('impose le changement du PIN temporaire sur toute autre page', async () => {
    const api = fakeApi();
    api.restore.mockResolvedValue(meResponse({ mustChangePin: true }));
    const navigate = vi.fn();
    renderWithProviders(
      <RequireAuth navigate={navigate} pathname="/team" changePinPath="/change-pin">
        <p>privé</p>
      </RequireAuth>,
      { api },
    );
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/change-pin'));
    expect(screen.queryByText('privé')).not.toBeInTheDocument();
  });

  it('affiche la page de changement du PIN elle-même', async () => {
    const api = fakeApi();
    api.restore.mockResolvedValue(meResponse({ mustChangePin: true }));
    const navigate = vi.fn();
    renderWithProviders(
      <RequireAuth navigate={navigate} pathname="/change-pin" changePinPath="/change-pin">
        <p>changer</p>
      </RequireAuth>,
      { api },
    );
    expect(await screen.findByText('changer')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('sans chemin de changement de PIN configuré (vitrine), ne bloque jamais', async () => {
    const api = fakeApi();
    api.restore.mockResolvedValue(meResponse({ mustChangePin: true }));
    renderWithProviders(
      <RequireAuth navigate={vi.fn()} pathname="/account">
        <p>compte</p>
      </RequireAuth>,
      { api },
    );
    expect(await screen.findByText('compte')).toBeInTheDocument();
  });
});

describe('RequireAuth — déconnexion demandée', () => {
  function LogoutButton() {
    const { signOut } = useAuth();
    return <button onClick={() => void signOut()}>quitter</button>;
  }

  it('ne redirige pas vers la connexion : la page choisit où aller', async () => {
    const api = fakeApi();
    api.restore.mockResolvedValue(meResponse());
    const navigate = vi.fn();
    const { events } = renderWithProviders(
      <RequireAuth navigate={navigate} pathname="/account">
        <LogoutButton />
      </RequireAuth>,
      { api },
    );
    await events.click(await screen.findByRole('button', { name: 'quitter' }));
    await vi.waitFor(() => expect(api.logout).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('sécurité du rendu', () => {
  it('ne rend jamais le contenu protégé tant que la session n’est pas connue', () => {
    const api = fakeApi();
    api.restore.mockReturnValue(new Promise(() => undefined));
    const navigate = vi.fn();
    renderWithProviders(
      <RequireAuth navigate={navigate} pathname="/">
        <p>secret</p>
      </RequireAuth>,
      { api },
    );
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Chargement…')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });
});
