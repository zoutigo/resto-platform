import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, renderApp, restaurant } from '@/test/render';
import { RestaurantProvider, useRestaurant } from './restaurant-context';

function Probe() {
  const { status, entries, active, select, reload } = useRestaurant();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="count">{entries.length}</p>
      <p data-testid="active">{active ? `${active.restaurant.name}/${active.role}` : 'aucun'}</p>
      <button onClick={() => select('r2')}>choisir r2</button>
      <button onClick={() => void reload()}>recharger</button>
    </div>
  );
}

afterEach(() => localStorage.clear());

describe('RestaurantProvider', () => {
  it('charge les restaurants et active le premier', async () => {
    renderApp(
      <RestaurantProvider>
        <Probe />
      </RestaurantProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    expect(screen.getByTestId('active')).toHaveTextContent('Chez Mama/OWNER');
  });

  it('mémorise le restaurant choisi et le retrouve au rechargement', async () => {
    const api = fakeApi({
      myRestaurants: vi.fn().mockResolvedValue([
        { role: 'OWNER', restaurant: restaurant('r1', 'Chez Mama') },
        { role: 'WAITER', restaurant: restaurant('r2', 'Le Palmier') },
      ]),
    });
    const { events, unmount } = renderApp(
      <RestaurantProvider>
        <Probe />
      </RestaurantProvider>,
      { api },
    );
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'));
    await events.click(screen.getByRole('button', { name: 'choisir r2' }));
    expect(screen.getByTestId('active')).toHaveTextContent('Le Palmier/WAITER');
    expect(localStorage.getItem('resto.activeRestaurant')).toBe('r2');
    unmount();

    renderApp(
      <RestaurantProvider>
        <Probe />
      </RestaurantProvider>,
      { api },
    );
    await waitFor(() =>
      expect(screen.getByTestId('active')).toHaveTextContent('Le Palmier/WAITER'),
    );
  });

  it('ignore un restaurant mémorisé qui n’existe plus', async () => {
    localStorage.setItem('resto.activeRestaurant', 'disparu');
    renderApp(
      <RestaurantProvider>
        <Probe />
      </RestaurantProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('Chez Mama/OWNER'));
  });

  it('sans restaurant : prêt mais aucun actif', async () => {
    renderApp(
      <RestaurantProvider>
        <Probe />
      </RestaurantProvider>,
      { api: fakeApi({ myRestaurants: vi.fn().mockResolvedValue([]) }) },
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    expect(screen.getByTestId('active')).toHaveTextContent('aucun');
  });

  it('signale une erreur de chargement puis récupère au rechargement', async () => {
    const myRestaurants = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue([{ role: 'OWNER', restaurant: restaurant() }]);
    const { events } = renderApp(
      <RestaurantProvider>
        <Probe />
      </RestaurantProvider>,
      { api: fakeApi({ myRestaurants }) },
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    await events.click(screen.getByRole('button', { name: 'recharger' }));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
  });

  it('exige d’être dans le fournisseur', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderApp(<Probe />)).toThrow(/RestaurantProvider/);
    spy.mockRestore();
  });
});
