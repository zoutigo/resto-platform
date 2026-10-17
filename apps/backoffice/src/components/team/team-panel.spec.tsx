import { ApiError, type TeamMember } from '@resto/shared';
import { notify } from '@resto/ui';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, renderApp } from '@/test/render';
import { TeamPanel } from './team-panel';

const member = (over: Partial<TeamMember> = {}): TeamMember => ({
  userId: 'm1',
  name: 'Jean Nkoulou',
  phone: '+237655112233',
  role: 'WAITER',
  mustChangePin: false,
  pinResettable: true,
  recoveryPendingUntil: null,
  ...over,
});

const ownerRow = member({
  userId: 'o1',
  name: 'Paul Essomba',
  phone: '+237699887766',
  role: 'OWNER',
  pinResettable: false,
});

beforeEach(() => {
  vi.spyOn(notify, 'success').mockReturnValue(1);
  vi.spyOn(notify, 'error').mockReturnValue(1);
  vi.spyOn(notify, 'info').mockReturnValue(1);
});
afterEach(() => vi.restoreAllMocks());

const panel = (role: 'OWNER' | 'SUPERVISOR' = 'OWNER') => (
  <TeamPanel restaurantId="r1" actorRole={role} />
);

describe('TeamPanel — liste', () => {
  it('affiche les membres avec rôle, PIN temporaire et récupération en attente', async () => {
    const api = fakeApi({
      team: vi.fn().mockResolvedValue([
        ownerRow,
        member({ mustChangePin: true }),
        member({
          userId: 'm2',
          name: 'Marie Ebogo',
          phone: '+237655000002',
          role: 'CASHIER',
          recoveryPendingUntil: '2026-10-19T10:00:00.000Z',
        }),
      ]),
    });
    renderApp(panel(), { api });
    const item = await screen.findByTestId('member-+237655112233');
    expect(item).toHaveTextContent('Jean Nkoulou');
    expect(item).toHaveTextContent('Serveur');
    expect(item).toHaveTextContent('PIN temporaire');
    expect(screen.getByTestId('member-+237655000002')).toHaveTextContent(
      /Récupération demandée \(effective le 19 oct/,
    );
    expect(api.team).toHaveBeenCalledWith('r1');
  });

  it('le propriétaire de la liste n’offre aucune action', async () => {
    renderApp(panel(), { api: fakeApi({ team: vi.fn().mockResolvedValue([ownerRow]) }) });
    const item = await screen.findByTestId('member-+237699887766');
    expect(within(item).queryByRole('button')).not.toBeInTheDocument();
    expect(within(item).queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('un gérant n’a pas d’action sur un autre gérant', async () => {
    const api = fakeApi({
      team: vi
        .fn()
        .mockResolvedValue([
          member({ role: 'SUPERVISOR' }),
          member({ userId: 'm2', phone: '+237655000002', role: 'WAITER' }),
        ]),
    });
    renderApp(panel('SUPERVISOR'), { api });
    const peer = await screen.findByTestId('member-+237655112233');
    expect(within(peer).queryByRole('button')).not.toBeInTheDocument();
    expect(
      within(await screen.findByTestId('member-+237655000002')).getByRole('button', {
        name: 'Retirer',
      }),
    ).toBeInTheDocument();
  });

  it('message de liste vide', async () => {
    renderApp(panel());
    expect(await screen.findByText('Aucun employé pour le moment.')).toBeInTheDocument();
  });

  it('une erreur de chargement est annoncée', async () => {
    const api = fakeApi({ team: vi.fn().mockRejectedValue(new ApiError(0, 'network.offline')) });
    renderApp(panel(), { api });
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(expect.stringContaining('Pas de connexion')),
    );
  });
});

describe('TeamPanel — ajout', () => {
  async function fillAndSubmit(events: ReturnType<typeof renderApp>['events'], role = 'WAITER') {
    await events.type(screen.getByLabelText('Nom complet'), 'Jean Nkoulou');
    await events.type(screen.getByLabelText('Numéro de téléphone'), '655 11 22 33');
    await events.selectOptions(screen.getByLabelText('Rôle', { exact: true }), role);
    await events.click(screen.getByRole('button', { name: /^Ajouter$/ }));
  }

  it('ajoute un employé et montre son PIN temporaire dans une boîte de dialogue', async () => {
    const api = fakeApi({
      addStaff: vi.fn().mockResolvedValue({ member: member(), temporaryPin: '482915' }),
    });
    const { events } = renderApp(panel(), { api });
    await fillAndSubmit(events);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('temporary-pin')).toHaveTextContent('482915');
    expect(api.addStaff).toHaveBeenCalledWith('r1', {
      name: 'Jean Nkoulou',
      phone: '+237655112233',
      role: 'WAITER',
    });
    expect(notify.success).toHaveBeenCalledWith('Employé ajouté');
    await events.click(within(dialog).getAllByRole('button', { name: 'Fermer' })[0]!);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('482915')).not.toBeInTheDocument();
  });

  it('un compte existant : pas de PIN, simple information', async () => {
    const api = fakeApi({
      addStaff: vi.fn().mockResolvedValue({ member: member(), temporaryPin: null }),
    });
    const { events } = renderApp(panel(), { api });
    await fillAndSubmit(events);
    await waitFor(() =>
      expect(notify.info).toHaveBeenCalledWith(expect.stringContaining('utilise déjà un compte')),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('un gérant ne peut choisir ni gérant ni propriétaire', async () => {
    renderApp(panel('SUPERVISOR'));
    await screen.findByText('Aucun employé pour le moment.');
    const options = within(screen.getByLabelText('Rôle', { exact: true }))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['Serveur', 'Caissier', 'Cuisinier']);
  });

  it('le propriétaire peut aussi nommer un gérant', async () => {
    renderApp(panel('OWNER'));
    await screen.findByText('Aucun employé pour le moment.');
    const options = within(screen.getByLabelText('Rôle', { exact: true }))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['Gérant', 'Serveur', 'Caissier', 'Cuisinier']);
  });

  it('refuse un nom ou un numéro invalide sans appeler l’API', async () => {
    const api = fakeApi();
    const { events } = renderApp(panel(), { api });
    await events.type(await screen.findByLabelText('Nom complet'), 'J');
    await events.type(screen.getByLabelText('Numéro de téléphone'), '123');
    await events.click(screen.getByRole('button', { name: /^Ajouter$/ }));
    expect(await screen.findByText('Saisissez au moins 2 caractères.')).toBeInTheDocument();
    expect(screen.getByText(/Numéro invalide/)).toBeInTheDocument();
    expect(api.addStaff).not.toHaveBeenCalled();
  });

  it.each([
    [new ApiError(409, 'team.alreadyMember'), 'fait déjà partie de l’équipe'],
    [new ApiError(403, 'team.cannotManageRole'), 'ne pouvez pas gérer ce rôle'],
    [new ApiError(500, 'server.error'), 'problème'],
  ])('affiche l’échec de l’ajout : %#', async (error, text) => {
    const api = fakeApi({ addStaff: vi.fn().mockRejectedValue(error) });
    const { events } = renderApp(panel(), { api });
    await fillAndSubmit(events);
    expect(await screen.findByTestId('form-error')).toHaveTextContent(text);
  });
});

describe('TeamPanel — actions sur un membre', () => {
  const withMember = (over: Partial<TeamMember> = {}, extra: Record<string, unknown> = {}) =>
    fakeApi({ team: vi.fn().mockResolvedValue([ownerRow, member(over)]), ...extra });

  it('change le rôle', async () => {
    const api = withMember(
      {},
      { changeStaffRole: vi.fn().mockResolvedValue(member({ role: 'CASHIER' })) },
    );
    const { events } = renderApp(panel(), { api });
    await events.selectOptions(await screen.findByLabelText('Rôle — Jean Nkoulou'), 'CASHIER');
    await waitFor(() => expect(api.changeStaffRole).toHaveBeenCalledWith('r1', 'm1', 'CASHIER'));
    expect(notify.success).toHaveBeenCalledWith('Rôle modifié');
  });

  it('réinitialise le PIN et l’affiche une fois', async () => {
    const api = withMember(
      {},
      { resetStaffPin: vi.fn().mockResolvedValue({ temporaryPin: '715204' }) },
    );
    const { events } = renderApp(panel(), { api });
    await events.click(await screen.findByRole('button', { name: 'Réinitialiser le PIN' }));
    expect(
      await within(await screen.findByRole('dialog')).findByTestId('temporary-pin'),
    ).toHaveTextContent('715204');
  });

  it('n’offre pas la réinitialisation d’un compte personnel', async () => {
    renderApp(panel(), { api: withMember({ pinResettable: false }) });
    await screen.findByTestId('member-+237655112233');
    expect(screen.queryByRole('button', { name: 'Réinitialiser le PIN' })).not.toBeInTheDocument();
  });

  it('annule une récupération en attente', async () => {
    const api = withMember(
      { recoveryPendingUntil: '2026-10-19T10:00:00.000Z' },
      { cancelStaffRecovery: vi.fn().mockResolvedValue({ cancelled: 1 }) },
    );
    const { events } = renderApp(panel(), { api });
    await events.click(await screen.findByRole('button', { name: 'Annuler la récupération' }));
    await waitFor(() => expect(api.cancelStaffRecovery).toHaveBeenCalledWith('r1', 'm1'));
    expect(notify.success).toHaveBeenCalledWith('Récupération annulée');
  });

  it('retire un employé seulement après confirmation', async () => {
    const api = withMember({}, { removeStaff: vi.fn().mockResolvedValue(undefined) });
    const { events } = renderApp(panel(), { api });
    await events.click(await screen.findByRole('button', { name: 'Retirer' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Retirer Jean Nkoulou de l’équipe ?');
    expect(api.removeStaff).not.toHaveBeenCalled();

    await events.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    expect(api.removeStaff).not.toHaveBeenCalled();

    await events.click(screen.getByRole('button', { name: 'Retirer' }));
    await events.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Retirer' }),
    );
    await waitFor(() => expect(api.removeStaff).toHaveBeenCalledWith('r1', 'm1'));
    expect(notify.success).toHaveBeenCalledWith('Accès retiré');
  });

  it('annonce l’échec d’une action', async () => {
    const api = withMember(
      {},
      { resetStaffPin: vi.fn().mockRejectedValue(new ApiError(403, 'team.accountNotManaged')) },
    );
    const { events } = renderApp(panel(), { api });
    await events.click(await screen.findByRole('button', { name: 'Réinitialiser le PIN' }));
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(expect.stringContaining('compte est personnel')),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
