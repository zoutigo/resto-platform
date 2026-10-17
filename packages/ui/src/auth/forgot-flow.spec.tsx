import { ApiError } from '@resto/shared';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notify } from '../feedback/notify';
import { fakeApi, renderWithProviders, session, user } from '../test/render';
import { ForgotFlow } from './forgot-flow';

beforeEach(() => {
  vi.spyOn(notify, 'success').mockReturnValue(1);
  vi.spyOn(notify, 'error').mockReturnValue(1);
});
afterEach(() => {
  vi.restoreAllMocks();
});

type Events = ReturnType<typeof renderWithProviders>['events'];

const choose = (events: Events, name: string) => events.click(screen.getByRole('button', { name }));

async function newPin(events: Events, pin = '715204') {
  await events.type(screen.getByLabelText('Nouveau PIN (6 chiffres)'), pin);
  await events.type(screen.getByLabelText('Confirmez le nouveau PIN'), pin);
}

describe('ForgotFlow — menu', () => {
  it('propose les trois méthodes', () => {
    renderWithProviders(<ForgotFlow audience="customer" onDone={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'J’ai mon code de secours' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Répondre à mes questions secrètes' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recevoir un code par email' })).toBeInTheDocument();
  });

  it('permet de revenir au menu', async () => {
    const { events } = renderWithProviders(<ForgotFlow audience="customer" onDone={vi.fn()} />);
    await choose(events, 'J’ai mon code de secours');
    await events.click(screen.getByRole('button', { name: /Retour/ }));
    expect(screen.getByRole('button', { name: 'J’ai mon code de secours' })).toBeInTheDocument();
  });
});

describe('ForgotFlow — code de secours', () => {
  it('réinitialise le PIN puis montre le NOUVEAU code de secours', async () => {
    const api = fakeApi();
    api.recoverWithCode.mockResolvedValue({ user, ...session, recoveryCode: 'WXYZ-2345-6789' });
    const onDone = vi.fn();
    const { events } = renderWithProviders(<ForgotFlow audience="customer" onDone={onDone} />, {
      api,
    });
    await choose(events, 'J’ai mon code de secours');
    await events.type(screen.getByLabelText('Numéro de téléphone'), '677 12 34 56');
    await events.type(screen.getByLabelText('Code de secours'), 'abcd-efgh-jkmn');
    await newPin(events);
    await events.click(screen.getByRole('button', { name: 'Réinitialiser mon PIN' }));

    expect(await screen.findByTestId('recovery-code')).toHaveTextContent('WXYZ-2345-6789');
    expect(screen.getByText(/L’ancien ne fonctionne plus/)).toBeInTheDocument();
    expect(api.recoverWithCode).toHaveBeenCalledWith({
      phone: '+237677123456',
      recoveryCode: 'abcd-efgh-jkmn',
      newPin: '715204',
      newPinConfirm: '715204',
    });
    await events.click(screen.getByLabelText('J’ai noté mon code de secours'));
    await events.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(onDone).toHaveBeenCalled();
  });

  it('informations incorrectes : message générique (aucune fuite sur le compte)', async () => {
    const api = fakeApi();
    api.recoverWithCode.mockRejectedValue(new ApiError(401, 'recovery.failed'));
    const { events } = renderWithProviders(<ForgotFlow audience="customer" onDone={vi.fn()} />, {
      api,
    });
    await choose(events, 'J’ai mon code de secours');
    await events.type(screen.getByLabelText('Numéro de téléphone'), '677123456');
    await events.type(screen.getByLabelText('Code de secours'), 'ZZZZ-ZZZZ-ZZZZ');
    await newPin(events);
    await events.click(screen.getByRole('button', { name: 'Réinitialiser mon PIN' }));
    expect(await screen.findByTestId('form-error')).toHaveTextContent('Informations incorrectes');
  });

  it('refuse un PIN faible ou non confirmé sans appeler l’API', async () => {
    const api = fakeApi();
    const { events } = renderWithProviders(<ForgotFlow audience="customer" onDone={vi.fn()} />, {
      api,
    });
    await choose(events, 'J’ai mon code de secours');
    await events.type(screen.getByLabelText('Numéro de téléphone'), '677123456');
    await events.type(screen.getByLabelText('Code de secours'), 'ABCD-EFGH-JKMN');
    await events.type(screen.getByLabelText('Nouveau PIN (6 chiffres)'), '123456');
    await events.type(screen.getByLabelText('Confirmez le nouveau PIN'), '123457');
    await events.click(screen.getByRole('button', { name: 'Réinitialiser mon PIN' }));
    expect(await screen.findByText(/trop facile à deviner/)).toBeInTheDocument();
    expect(api.recoverWithCode).not.toHaveBeenCalled();
  });

  it('trop de tentatives : indique le délai', async () => {
    const api = fakeApi();
    api.recoverWithCode.mockRejectedValue(new ApiError(429, 'auth.tooManyAttempts', [], 30));
    const { events } = renderWithProviders(<ForgotFlow audience="customer" onDone={vi.fn()} />, {
      api,
    });
    await choose(events, 'J’ai mon code de secours');
    await events.type(screen.getByLabelText('Numéro de téléphone'), '677123456');
    await events.type(screen.getByLabelText('Code de secours'), 'ABCD-EFGH-JKMN');
    await newPin(events);
    await events.click(screen.getByRole('button', { name: 'Réinitialiser mon PIN' }));
    expect(await screen.findByTestId('form-error')).toHaveTextContent('Réessayez dans 30 s');
  });
});

describe('ForgotFlow — questions secrètes', () => {
  async function fillQuestions(events: Events, count: number) {
    await events.type(screen.getByLabelText('Numéro de téléphone'), '677123456');
    await events.selectOptions(screen.getByLabelText('Jour'), '5');
    await events.selectOptions(screen.getByLabelText('Mois'), '3');
    await events.selectOptions(screen.getByLabelText('Année'), '1990');
    const questions = ['BIRTH_CITY', 'FAVORITE_SPORT'];
    for (let i = 0; i < count; i++) {
      await events.selectOptions(screen.getAllByLabelText(/^Question \d/)[i]!, questions[i]!);
      await events.type(
        screen.getAllByPlaceholderText('Votre réponse')[i]!,
        i === 0 ? 'Douala' : 'Football',
      );
    }
    await newPin(events);
    await events.click(screen.getByRole('button', { name: 'Vérifier mes réponses' }));
  }

  it('client : application immédiate, avec rappel du mode restreint', async () => {
    const api = fakeApi();
    api.recoverWithQuestions.mockResolvedValue({ user, ...session });
    const { events } = renderWithProviders(<ForgotFlow audience="customer" onDone={vi.fn()} />, {
      api,
    });
    await choose(events, 'Répondre à mes questions secrètes');
    await fillQuestions(events, 1);
    expect(
      await screen.findByText(/certaines actions sont limitées pendant 48 h/),
    ).toBeInTheDocument();
    expect(api.recoverWithQuestions).toHaveBeenCalledWith({
      phone: '+237677123456',
      birthDate: '1990-03-05',
      recoveryAnswers: [{ question: 'BIRTH_CITY', answer: 'Douala' }],
      newPin: '715204',
      newPinConfirm: '715204',
    });
  });

  it('restaurateur : deux questions, et une demande différée affiche la date d’effet', async () => {
    const api = fakeApi({ audience: 'staff' });
    api.recoverWithQuestions.mockResolvedValue({
      status: 'pending',
      availableAt: '2026-10-19T10:00:00.000Z',
    });
    const { events } = renderWithProviders(<ForgotFlow audience="staff" onDone={vi.fn()} />, {
      api,
    });
    await choose(events, 'Répondre à mes questions secrètes');
    expect(screen.getAllByLabelText(/^Question \d/)).toHaveLength(2);
    await fillQuestions(events, 2);

    expect(await screen.findByText('Demande enregistrée')).toBeInTheDocument();
    expect(screen.getByText(/19 octobre 2026/)).toBeInTheDocument();
    expect(screen.getByText(/ancien PIN, la demande sera annulée/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finaliser la récupération' })).toBeInTheDocument();
  });

  it('réponses incorrectes : message générique', async () => {
    const api = fakeApi();
    api.recoverWithQuestions.mockRejectedValue(new ApiError(401, 'recovery.failed'));
    const { events } = renderWithProviders(<ForgotFlow audience="customer" onDone={vi.fn()} />, {
      api,
    });
    await choose(events, 'Répondre à mes questions secrètes');
    await fillQuestions(events, 1);
    expect(await screen.findByTestId('form-error')).toHaveTextContent('Informations incorrectes');
  });

  it('exige la date et la question', async () => {
    const api = fakeApi();
    const { events } = renderWithProviders(<ForgotFlow audience="customer" onDone={vi.fn()} />, {
      api,
    });
    await choose(events, 'Répondre à mes questions secrètes');
    await events.type(screen.getByLabelText('Numéro de téléphone'), '677123456');
    await newPin(events);
    await events.click(screen.getByRole('button', { name: 'Vérifier mes réponses' }));
    expect(await screen.findByText('Date de naissance invalide.')).toBeInTheDocument();
    expect(api.recoverWithQuestions).not.toHaveBeenCalled();
  });
});

describe('ForgotFlow — finalisation différée', () => {
  async function open(events: Events) {
    await choose(events, 'Finaliser la récupération');
    await events.type(screen.getByLabelText('Numéro de téléphone'), '699887766');
    await events.type(screen.getByLabelText('Nouveau PIN (6 chiffres)'), '715204');
    await events.click(screen.getByRole('button', { name: 'Finaliser' }));
  }

  it('applique le PIN choisi au départ', async () => {
    const api = fakeApi();
    api.completeRecovery.mockResolvedValue({ user, ...session });
    const onDone = vi.fn();
    const { events } = renderWithProviders(<ForgotFlow audience="staff" onDone={onDone} />, {
      api,
    });
    await open(events);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.completeRecovery).toHaveBeenCalledWith({ phone: '+237699887766', newPin: '715204' });
  });

  it('avant l’échéance : affiche la date', async () => {
    const api = fakeApi();
    const error = new ApiError(409, 'recovery.notYetAvailable', [], undefined, {
      availableAt: '2026-10-19T10:00:00.000Z',
    });
    api.completeRecovery.mockRejectedValue(error);
    const { events } = renderWithProviders(<ForgotFlow audience="staff" onDone={vi.fn()} />, {
      api,
    });
    await open(events);
    expect(await screen.findByTestId('form-error')).toHaveTextContent(/19 octobre 2026/);
  });
});

describe('ForgotFlow — email', () => {
  async function askCode(events: Events, email = 'awa@gmail.com') {
    await choose(events, 'Recevoir un code par email');
    await events.type(screen.getByLabelText('Adresse email'), email);
    await events.click(screen.getByRole('button', { name: 'Envoyer le code' }));
  }

  it('envoie le code puis réinitialise le PIN', async () => {
    const api = fakeApi();
    api.forgotByEmail.mockResolvedValue({ sent: true });
    api.recoverWithEmail.mockResolvedValue({ user, ...session });
    const { events } = renderWithProviders(<ForgotFlow audience="customer" onDone={vi.fn()} />, {
      api,
    });
    await askCode(events);
    await events.type(await screen.findByLabelText('Code reçu par email'), '482915');
    await newPin(events);
    await events.click(screen.getByRole('button', { name: 'Réinitialiser' }));

    expect(await screen.findByText('Accès rétabli')).toBeInTheDocument();
    expect(api.forgotByEmail).toHaveBeenCalledWith({ email: 'awa@gmail.com', locale: 'fr' });
    expect(api.recoverWithEmail).toHaveBeenCalledWith({
      email: 'awa@gmail.com',
      code: '482915',
      newPin: '715204',
      newPinConfirm: '715204',
    });
  });

  it('peut plutôt définir un nouveau mot de passe', async () => {
    const api = fakeApi();
    api.forgotByEmail.mockResolvedValue({ sent: true });
    api.recoverWithEmail.mockResolvedValue({ user, ...session });
    const { events } = renderWithProviders(<ForgotFlow audience="customer" onDone={vi.fn()} />, {
      api,
    });
    await askCode(events);
    await events.type(await screen.findByLabelText('Code reçu par email'), '482915');
    await events.click(screen.getByRole('button', { name: 'Mon mot de passe' }));
    await events.type(screen.getByLabelText('Nouveau mot de passe'), 'Nouveau-mdp-9');
    await events.click(screen.getByRole('button', { name: 'Réinitialiser' }));
    await waitFor(() => expect(api.recoverWithEmail).toHaveBeenCalled());
    expect(api.recoverWithEmail).toHaveBeenCalledWith({
      email: 'awa@gmail.com',
      code: '482915',
      newPassword: 'Nouveau-mdp-9',
    });
  });

  it('code incorrect : message général', async () => {
    const api = fakeApi();
    api.forgotByEmail.mockResolvedValue({ sent: true });
    api.recoverWithEmail.mockRejectedValue(new ApiError(400, 'emailCode.invalid'));
    const { events } = renderWithProviders(<ForgotFlow audience="customer" onDone={vi.fn()} />, {
      api,
    });
    await askCode(events);
    await events.type(await screen.findByLabelText('Code reçu par email'), '000000');
    await newPin(events);
    await events.click(screen.getByRole('button', { name: 'Réinitialiser' }));
    expect(await screen.findByTestId('form-error')).toHaveTextContent('Code incorrect ou expiré.');
  });

  it('refuse un mot de passe faible sans appeler l’API', async () => {
    const api = fakeApi();
    api.forgotByEmail.mockResolvedValue({ sent: true });
    const { events } = renderWithProviders(<ForgotFlow audience="customer" onDone={vi.fn()} />, {
      api,
    });
    await askCode(events);
    await events.type(await screen.findByLabelText('Code reçu par email'), '482915');
    await events.click(screen.getByRole('button', { name: 'Mon mot de passe' }));
    await events.type(screen.getByLabelText('Nouveau mot de passe'), 'password');
    await events.click(screen.getByRole('button', { name: 'Réinitialiser' }));
    expect(await screen.findByText(/trop courant/)).toBeInTheDocument();
    expect(api.recoverWithEmail).not.toHaveBeenCalled();
  });

  it('adresse invalide : pas d’envoi', async () => {
    const api = fakeApi();
    const { events } = renderWithProviders(<ForgotFlow audience="customer" onDone={vi.fn()} />, {
      api,
    });
    await askCode(events, 'nope');
    expect(await screen.findByText('Adresse email invalide.')).toBeInTheDocument();
    expect(api.forgotByEmail).not.toHaveBeenCalled();
  });
});
