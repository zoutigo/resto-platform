import { screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, owner, renderApp } from '@/test/render';
import { SiteHeader } from './site-header';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, replace: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => refresh.mockClear());

describe('SiteHeader', () => {
  it('propose la connexion à un visiteur', async () => {
    renderApp(<SiteHeader />);
    expect(await screen.findByRole('link', { name: 'Connexion' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(screen.queryByRole('link', { name: 'Mon compte' })).not.toBeInTheDocument();
  });

  it('propose « Mon compte » à un client connecté', async () => {
    const api = fakeApi({
      restore: vi
        .fn()
        .mockResolvedValue({ user: owner, mustChangePin: false, recoveryPending: null }),
    });
    renderApp(<SiteHeader />, { api });
    expect(await screen.findByRole('link', { name: 'Mon compte' })).toHaveAttribute(
      'href',
      '/account',
    );
    expect(screen.queryByRole('link', { name: 'Connexion' })).not.toBeInTheDocument();
  });

  it('n’affiche ni connexion ni compte tant que la session se charge', () => {
    renderApp(<SiteHeader />, {
      api: fakeApi({ restore: vi.fn().mockReturnValue(new Promise(() => undefined)) }),
    });
    expect(screen.queryByRole('link', { name: 'Connexion' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Mon compte' })).not.toBeInTheDocument();
  });

  it('mémorise la langue choisie et recharge la page', async () => {
    const { events } = renderApp(<SiteHeader />);
    await events.click(await screen.findByRole('button', { name: 'EN' }));
    expect(document.cookie).toContain('locale=en');
    expect(refresh).toHaveBeenCalled();
  });

  it('le lien de la marque mène à l’accueil', async () => {
    renderApp(<SiteHeader />);
    expect(await screen.findByRole('link', { name: 'Resto' })).toHaveAttribute('href', '/');
  });

  it('suit la langue', async () => {
    renderApp(<SiteHeader />, { locale: 'en' });
    await waitFor(() => expect(screen.getByRole('link', { name: 'Log in' })).toBeInTheDocument());
  });
});
