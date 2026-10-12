import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Home from './page';

describe('Page d’accueil', () => {
  it('affiche le titre et un prix formaté en FCFA', () => {
    render(<Home />);
    expect(screen.getByRole('heading', { level: 1, name: 'Vitrine' })).toBeInTheDocument();
    expect(screen.getByText(/2\s500\sFCFA/)).toBeInTheDocument();
  });
});
