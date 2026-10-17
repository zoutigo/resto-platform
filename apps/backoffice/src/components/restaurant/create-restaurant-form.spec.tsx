import { ApiError } from '@resto/shared';
import { notify } from '@resto/ui';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, renderApp, restaurant } from '@/test/render';
import { CreateRestaurantForm } from './create-restaurant-form';

beforeEach(() => {
  vi.spyOn(notify, 'success').mockReturnValue(1);
  vi.spyOn(notify, 'error').mockReturnValue(1);
});
afterEach(() => vi.restoreAllMocks());

describe('CreateRestaurantForm', () => {
  it('crée le restaurant, annonce le succès et continue', async () => {
    const api = fakeApi({ createRestaurant: vi.fn().mockResolvedValue(restaurant()) });
    const onDone = vi.fn();
    const { events } = renderApp(<CreateRestaurantForm onDone={onDone} />, { api });
    await events.type(screen.getByLabelText('Nom du restaurant'), '  Chez Mama ');
    await events.type(screen.getByLabelText('Ville'), 'Douala');
    await events.click(screen.getByRole('button', { name: 'Créer mon restaurant' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.createRestaurant).toHaveBeenCalledWith({
      name: 'Chez Mama',
      city: 'Douala',
      address: undefined,
    });
    expect(notify.success).toHaveBeenCalledWith('Restaurant créé');
  });

  it('transmet l’adresse quand elle est saisie', async () => {
    const api = fakeApi({ createRestaurant: vi.fn().mockResolvedValue(restaurant()) });
    const { events } = renderApp(<CreateRestaurantForm onDone={vi.fn()} />, { api });
    await events.type(screen.getByLabelText('Nom du restaurant'), 'Chez Mama');
    await events.type(screen.getByLabelText('Ville'), 'Douala');
    await events.type(screen.getByLabelText('Adresse (facultatif)'), 'Akwa');
    await events.click(screen.getByRole('button', { name: 'Créer mon restaurant' }));
    await waitFor(() => expect(api.createRestaurant).toHaveBeenCalled());
    expect(api.createRestaurant).toHaveBeenCalledWith(expect.objectContaining({ address: 'Akwa' }));
  });

  it('valide le nom et la ville sans appeler l’API', async () => {
    const api = fakeApi();
    const { events } = renderApp(<CreateRestaurantForm onDone={vi.fn()} />, { api });
    await events.type(screen.getByLabelText('Nom du restaurant'), '!!');
    await events.click(screen.getByRole('button', { name: 'Créer mon restaurant' }));
    expect(await screen.findByText('Ce nom n’est pas valide.')).toBeInTheDocument();
    expect(screen.getByText('Indiquez la ville.')).toBeInTheDocument();
    expect(api.createRestaurant).not.toHaveBeenCalled();
  });

  it.each([
    [new ApiError(429, 'auth.tooManyAttempts', [], 30), 'Réessayez dans 30 s'],
    [new ApiError(500, 'server.error'), 'Le service rencontre un problème'],
    [new ApiError(0, 'network.offline'), 'Pas de connexion'],
    [new ApiError(401, 'auth.invalidSession'), 'Session expirée'],
  ])('affiche l’échec : %#', async (error, text) => {
    const api = fakeApi({ createRestaurant: vi.fn().mockRejectedValue(error) });
    const onDone = vi.fn();
    const { events } = renderApp(<CreateRestaurantForm onDone={onDone} />, { api });
    await events.type(screen.getByLabelText('Nom du restaurant'), 'Chez Mama');
    await events.type(screen.getByLabelText('Ville'), 'Douala');
    await events.click(screen.getByRole('button', { name: 'Créer mon restaurant' }));
    expect(await screen.findByTestId('form-error')).toHaveTextContent(text);
    expect(notify.error).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});
