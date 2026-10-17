import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fakeApi, owner, renderApp } from '@/test/render';
import { HomeContent } from './home-content';

describe('HomeContent', () => {
  it('accueille un visiteur', async () => {
    renderApp(<HomeContent />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Bienvenue' })).toBeInTheDocument();
    expect(screen.getByText(/Réservez et commandez à emporter/)).toBeInTheDocument();
  });

  it('salue un client connecté par son nom', async () => {
    const api = fakeApi({
      restore: vi
        .fn()
        .mockResolvedValue({ user: owner, mustChangePin: false, recoveryPending: null }),
    });
    renderApp(<HomeContent />, { api });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Bonjour Paul Essomba' }),
    ).toBeInTheDocument();
  });

  it('s’affiche en anglais', async () => {
    renderApp(<HomeContent />, { locale: 'en' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome' })).toBeInTheDocument();
  });
});
