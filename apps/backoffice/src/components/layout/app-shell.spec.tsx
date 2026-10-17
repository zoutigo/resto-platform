import { screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, renderApp, restaurant } from '@/test/render';
import { RestaurantProvider } from '../restaurant/restaurant-context';
import { AppShell } from './app-shell';

const refresh = vi.fn();
let pathname = '/';

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ refresh, replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  pathname = '/';
  refresh.mockClear();
  localStorage.clear();
});

const shell = () => (
  <RestaurantProvider>
    <AppShell>
      <p>contenu</p>
    </AppShell>
  </RestaurantProvider>
);

describe('AppShell', () => {
  it('propose tableau de bord, équipe et compte au propriétaire (menu latéral et barre basse)', async () => {
    renderApp(shell());
    await screen.findByText('contenu');
    for (const label of ['Tableau de bord', 'Équipe', 'Compte']) {
      expect(screen.getAllByRole('link', { name: label })).toHaveLength(2);
    }
    expect(screen.getByTestId('restaurant-name')).toHaveTextContent('Chez Mama');
  });

  it.each(['WAITER', 'CASHIER', 'PREPARATOR'])('%s ne voit pas « Équipe »', async (role) => {
    const api = fakeApi({
      myRestaurants: vi.fn().mockResolvedValue([{ role, restaurant: restaurant() }]),
    });
    renderApp(shell(), { api });
    await screen.findByText('contenu');
    expect(screen.queryByRole('link', { name: 'Équipe' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Compte' }).length).toBeGreaterThan(0);
  });

  it('le gérant voit « Équipe »', async () => {
    const api = fakeApi({
      myRestaurants: vi.fn().mockResolvedValue([{ role: 'SUPERVISOR', restaurant: restaurant() }]),
    });
    renderApp(shell(), { api });
    await screen.findByText('contenu');
    expect(screen.getAllByRole('link', { name: 'Équipe' }).length).toBeGreaterThan(0);
  });

  it('marque la page courante (accessibilité)', async () => {
    pathname = '/team';
    renderApp(shell());
    await screen.findByText('contenu');
    const current = screen.getAllByRole('link', { current: 'page' });
    expect(current.length).toBeGreaterThan(0);
    for (const link of current) expect(link).toHaveTextContent('Équipe');
  });

  it('propose un sélecteur quand l’utilisateur a plusieurs restaurants', async () => {
    const api = fakeApi({
      myRestaurants: vi.fn().mockResolvedValue([
        { role: 'OWNER', restaurant: restaurant('r1', 'Chez Mama') },
        { role: 'WAITER', restaurant: restaurant('r2', 'Le Palmier') },
      ]),
    });
    const { events } = renderApp(shell(), { api });
    const select = await screen.findByLabelText('Restaurant');
    await events.selectOptions(select, 'r2');
    await waitFor(() => expect(select).toHaveValue('r2'));
    // Le rôle suit le restaurant choisi : serveur dans le second → plus d'« Équipe ».
    expect(screen.queryByRole('link', { name: 'Équipe' })).not.toBeInTheDocument();
  });

  it('mémorise la langue choisie et recharge', async () => {
    const { events } = renderApp(shell());
    await screen.findByText('contenu');
    await events.click(screen.getByRole('button', { name: 'EN' }));
    expect(document.cookie).toContain('locale=en');
    expect(refresh).toHaveBeenCalled();
  });
});
