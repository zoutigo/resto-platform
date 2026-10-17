import { ApiError } from '@resto/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notify } from '../feedback/notify';
import { fakeApi, renderWithProviders, session, user } from '../test/render';
import { RegisterPhoneForm } from './register-phone-form';

beforeEach(() => {
  vi.spyOn(notify, 'success').mockReturnValue(1);
  vi.spyOn(notify, 'error').mockReturnValue(1);
});
afterEach(() => {
  vi.restoreAllMocks();
});

type Events = ReturnType<typeof renderWithProviders>['events'];

const next = (events: Events) => events.click(screen.getByRole('button', { name: 'Continuer' }));

async function customerIdentity(events: Events, name = 'Awa Mbarga', phone = '677 12 34 56') {
  await events.type(screen.getByLabelText('Nom complet'), name);
  await events.type(screen.getByLabelText('Numéro de téléphone'), phone);
  await next(events);
}

async function pinStep(events: Events, pin = '483920', confirm = pin) {
  await events.type(screen.getByLabelText('Code PIN (6 chiffres)'), pin);
  await events.type(screen.getByLabelText('Confirmez le PIN'), confirm);
  await next(events);
}

async function recoveryStep(
  events: Events,
  answers: [string, string][] = [['BIRTH_CITY', 'Douala']],
) {
  await events.selectOptions(screen.getByLabelText('Jour'), '5');
  await events.selectOptions(screen.getByLabelText('Mois'), '3');
  await events.selectOptions(screen.getByLabelText('Année'), '1990');
  for (const [index, [question, answer]] of answers.entries()) {
    const selects = screen.getAllByLabelText(/^Question \d/);
    await events.selectOptions(selects[index]!, question);
    await events.type(screen.getAllByPlaceholderText('Votre réponse')[index]!, answer);
  }
}

describe('RegisterPhoneForm — client', () => {
  it('parcourt les trois étapes, envoie les données normalisées puis affiche le code de secours', async () => {
    const api = fakeApi();
    api.registerWithPhone.mockResolvedValue({ user, ...session, recoveryCode: 'ABCD-EFGH-JKMN' });
    const onDone = vi.fn();
    const { events } = renderWithProviders(
      <RegisterPhoneForm audience="customer" onDone={onDone} />,
      { api },
    );

    expect(screen.getByText(/Étape 1 sur 3/)).toBeInTheDocument();
    await customerIdentity(events);
    expect(await screen.findByText(/Étape 2 sur 3/)).toBeInTheDocument();
    await pinStep(events);
    expect(await screen.findByText(/Étape 3 sur 3/)).toBeInTheDocument();
    await recoveryStep(events);
    await events.click(screen.getByRole('button', { name: 'Créer mon compte' }));

    expect(await screen.findByTestId('recovery-code')).toHaveTextContent('ABCD-EFGH-JKMN');
    expect(api.registerWithPhone).toHaveBeenCalledWith({
      name: 'Awa Mbarga',
      phone: '+237677123456',
      pin: '483920',
      pinConfirm: '483920',
      birthDate: '1990-03-05',
      recoveryAnswers: [{ question: 'BIRTH_CITY', answer: 'Douala' }],
    });
    expect(notify.success).toHaveBeenCalledWith('Compte créé');

    // On ne peut pas continuer sans avoir confirmé avoir noté le code.
    const cont = screen.getByRole('button', { name: 'Continuer' });
    expect(cont).toBeDisabled();
    expect(onDone).not.toHaveBeenCalled();
    await events.click(screen.getByLabelText('J’ai noté mon code de secours'));
    await events.click(cont);
    expect(onDone).toHaveBeenCalled();
  });

  it('bloque l’étape 1 avec des messages traduits tant que les champs sont invalides', async () => {
    const { events } = renderWithProviders(
      <RegisterPhoneForm audience="customer" onDone={vi.fn()} />,
    );
    await customerIdentity(events, 'A', '12345');
    expect(await screen.findByText('Saisissez au moins 2 caractères.')).toBeInTheDocument();
    expect(screen.getByText(/Numéro invalide/)).toBeInTheDocument();
    expect(screen.getByText(/Étape 1 sur 3/)).toBeInTheDocument();
  });

  it('refuse un PIN facile à deviner à l’étape 2', async () => {
    const { events } = renderWithProviders(
      <RegisterPhoneForm audience="customer" onDone={vi.fn()} />,
    );
    await customerIdentity(events);
    await pinStep(events, '123456');
    expect(await screen.findByText(/trop facile à deviner/)).toBeInTheDocument();
    expect(screen.getByText(/Étape 2 sur 3/)).toBeInTheDocument();
  });

  it('refuse deux PIN différents à l’étape 2', async () => {
    const { events } = renderWithProviders(
      <RegisterPhoneForm audience="customer" onDone={vi.fn()} />,
    );
    await customerIdentity(events);
    await pinStep(events, '483920', '483921');
    expect(await screen.findByText('Les deux PIN ne sont pas identiques.')).toBeInTheDocument();
    expect(screen.getByText(/Étape 2 sur 3/)).toBeInTheDocument();
  });

  it('permet de revenir en arrière sans perdre la saisie', async () => {
    const { events } = renderWithProviders(
      <RegisterPhoneForm audience="customer" onDone={vi.fn()} />,
    );
    await customerIdentity(events);
    await events.click(screen.getByRole('button', { name: 'Retour' }));
    expect(screen.getByLabelText('Nom complet')).toHaveValue('Awa Mbarga');
    expect(screen.getByLabelText('Numéro de téléphone')).toHaveValue('677 12 34 56');
  });

  it('la touche Entrée fait avancer d’étape sans envoyer le formulaire', async () => {
    const api = fakeApi();
    const { events } = renderWithProviders(
      <RegisterPhoneForm audience="customer" onDone={vi.fn()} />,
      { api },
    );
    await events.type(screen.getByLabelText('Nom complet'), 'Awa Mbarga');
    await events.type(screen.getByLabelText('Numéro de téléphone'), '677123456{Enter}');
    expect(await screen.findByText(/Étape 2 sur 3/)).toBeInTheDocument();
    expect(api.registerWithPhone).not.toHaveBeenCalled();
  });

  it('exige la date et la question à l’étape 3', async () => {
    const api = fakeApi();
    const { events } = renderWithProviders(
      <RegisterPhoneForm audience="customer" onDone={vi.fn()} />,
      { api },
    );
    await customerIdentity(events);
    await pinStep(events);
    await events.click(await screen.findByRole('button', { name: 'Créer mon compte' }));
    expect(await screen.findByText('Date de naissance invalide.')).toBeInTheDocument();
    expect(screen.getByText('Choisissez une question.')).toBeInTheDocument();
    expect(api.registerWithPhone).not.toHaveBeenCalled();
  });

  it('numéro déjà pris : message général et toast, on reste sur le formulaire', async () => {
    const api = fakeApi();
    api.registerWithPhone.mockRejectedValue(new ApiError(409, 'auth.phoneTaken'));
    const { events } = renderWithProviders(
      <RegisterPhoneForm audience="customer" onDone={vi.fn()} />,
      { api },
    );
    await customerIdentity(events);
    await pinStep(events);
    await recoveryStep(events);
    await events.click(await screen.findByRole('button', { name: 'Créer mon compte' }));
    expect(await screen.findByTestId('form-error')).toHaveTextContent(
      'Ce numéro est déjà utilisé.',
    );
    expect(notify.error).toHaveBeenCalledWith('Ce numéro est déjà utilisé.');
    expect(screen.queryByTestId('recovery-code')).not.toBeInTheDocument();
  });

  it('serveur indisponible ou réseau coupé : message général', async () => {
    const api = fakeApi();
    api.registerWithPhone.mockRejectedValue(new ApiError(0, 'network.offline'));
    const { events } = renderWithProviders(
      <RegisterPhoneForm audience="customer" onDone={vi.fn()} />,
      { api },
    );
    await customerIdentity(events);
    await pinStep(events);
    await recoveryStep(events);
    await events.click(await screen.findByRole('button', { name: 'Créer mon compte' }));
    expect(await screen.findByTestId('form-error')).toHaveTextContent('Pas de connexion');
  });

  it('le menu des questions ne propose plus une question déjà choisie ailleurs', async () => {
    const { events } = renderWithProviders(<RegisterPhoneForm audience="staff" onDone={vi.fn()} />);
    await events.type(screen.getByLabelText('Prénom'), 'Paul');
    await events.type(screen.getByLabelText('Nom'), 'Essomba');
    await events.type(screen.getByLabelText('Numéro de téléphone'), '699 88 77 66');
    await next(events);
    await pinStep(events, '715204');
    const [first, second] = await screen.findAllByLabelText(/^Question \d/);
    await events.selectOptions(first!, 'BIRTH_CITY');
    const options = within(second!)
      .getAllByRole('option')
      .map((o) => o.getAttribute('value'));
    expect(options).not.toContain('BIRTH_CITY');
    expect(options).toContain('FAVORITE_SPORT');
  });
});

describe('RegisterPhoneForm — restaurateur', () => {
  it('demande prénom, nom et deux questions, et les envoie', async () => {
    const api = fakeApi();
    api.registerWithPhone.mockResolvedValue({ user, ...session, recoveryCode: 'ABCD-EFGH-JKMN' });
    const { events } = renderWithProviders(
      <RegisterPhoneForm audience="staff" onDone={vi.fn()} />,
      { api },
    );
    await events.type(screen.getByLabelText('Prénom'), 'Paul');
    await events.type(screen.getByLabelText('Nom'), 'Essomba');
    await events.type(screen.getByLabelText('Numéro de téléphone'), '699 88 77 66');
    await next(events);
    await pinStep(events, '715204');
    await recoveryStep(events, [
      ['BIRTH_CITY', 'Bafoussam'],
      ['FAVORITE_SPORT', 'Football'],
    ]);
    await events.click(await screen.findByRole('button', { name: 'Créer mon compte' }));
    await waitFor(() => expect(api.registerWithPhone).toHaveBeenCalled());
    expect(api.registerWithPhone).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Paul',
        lastName: 'Essomba',
        phone: '+237699887766',
        recoveryAnswers: [
          { question: 'BIRTH_CITY', answer: 'Bafoussam' },
          { question: 'FAVORITE_SPORT', answer: 'Football' },
        ],
      }),
    );
  });

  it('refuse un restaurateur qui ne répond qu’à une question', async () => {
    const api = fakeApi();
    const { events } = renderWithProviders(
      <RegisterPhoneForm audience="staff" onDone={vi.fn()} />,
      { api },
    );
    await events.type(screen.getByLabelText('Prénom'), 'Paul');
    await events.type(screen.getByLabelText('Nom'), 'Essomba');
    await events.type(screen.getByLabelText('Numéro de téléphone'), '699 88 77 66');
    await next(events);
    await pinStep(events, '715204');
    await recoveryStep(events, [['BIRTH_CITY', 'Bafoussam']]);
    await events.click(await screen.findByRole('button', { name: 'Créer mon compte' }));
    expect(await screen.findByText('Choisissez une question.')).toBeInTheDocument();
    expect(api.registerWithPhone).not.toHaveBeenCalled();
  });

  it('affiche le texte en anglais', () => {
    renderWithProviders(<RegisterPhoneForm audience="staff" onDone={vi.fn()} />, { locale: 'en' });
    expect(screen.getByText(/Step 1 of 3/)).toBeInTheDocument();
    expect(screen.getByLabelText('First name')).toBeInTheDocument();
  });
});
