import {
  NEW_PIN,
  PIN,
  PASSWORD,
  expect,
  makeRecoveryDue,
  test,
  uniqueEmail,
} from '@resto/e2e-support';
import { loginWithPhone, pinInput } from './helpers';

test.describe('PIN ou mot de passe oublié', () => {
  test('avec le code de secours : nouveau PIN, nouveau code, connexion possible', async ({
    page,
    api,
  }) => {
    const owner = await api.ownerWithRestaurant('Resto Secours');
    await page.goto('/forgot');
    await page.getByRole('button', { name: 'J’ai mon code de secours' }).click();
    await page.getByLabel('Numéro de téléphone').fill(owner.phone.replace('+237', ''));
    await page.getByLabel('Code de secours').fill(owner.recoveryCode.toLowerCase());
    await pinInput(page, 'Nouveau PIN (6 chiffres)').fill(NEW_PIN);
    await pinInput(page, 'Confirmez le nouveau PIN').fill(NEW_PIN);
    await page.getByRole('button', { name: 'Réinitialiser mon PIN' }).click();

    // Un NOUVEAU code de secours est remis ; l'ancien ne fonctionne plus.
    const next = (await page.getByTestId('recovery-code').textContent())?.trim();
    expect(next).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){2}$/);
    expect(next).not.toBe(owner.recoveryCode);
    await page.getByLabel('J’ai noté mon code de secours').check();
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.getByTestId('restaurant-name')).toHaveText('Resto Secours');

    await expect(
      api.call('/auth/staff/login', { body: { phone: owner.phone, pin: PIN } }),
    ).rejects.toThrow(/401/);
    await expect(
      api.call('/auth/staff/login', { body: { phone: owner.phone, pin: NEW_PIN } }),
    ).resolves.toBeTruthy();
  });

  test('un mauvais code de secours est refusé avec un message générique', async ({ page, api }) => {
    const owner = await api.ownerWithRestaurant();
    await page.goto('/forgot');
    await page.getByRole('button', { name: 'J’ai mon code de secours' }).click();
    await page.getByLabel('Numéro de téléphone').fill(owner.phone.replace('+237', ''));
    await page.getByLabel('Code de secours').fill('ZZZZ-ZZZZ-ZZZZ');
    await pinInput(page, 'Nouveau PIN (6 chiffres)').fill(NEW_PIN);
    await pinInput(page, 'Confirmez le nouveau PIN').fill(NEW_PIN);
    await page.getByRole('button', { name: 'Réinitialiser mon PIN' }).click();
    await expect(page.getByTestId('form-error')).toContainText('Informations incorrectes');
  });

  test('par questions secrètes : la demande du propriétaire est différée et annulée par sa connexion', async ({
    page,
    api,
  }) => {
    const owner = await api.ownerWithRestaurant();
    await page.goto('/forgot');
    await page.getByRole('button', { name: 'Répondre à mes questions secrètes' }).click();
    await page.getByLabel('Numéro de téléphone').fill(owner.phone.replace('+237', ''));
    await page.getByLabel('Jour').selectOption('12');
    await page.getByLabel('Mois').selectOption('11');
    await page.getByLabel('Année').selectOption('1980');
    await page.getByLabel(/^Question 1/).selectOption('BIRTH_CITY');
    await page.getByLabel('Votre réponse 1').fill('bafoussam');
    await page.getByLabel(/^Question 2/).selectOption('FAVORITE_SPORT');
    await page.getByLabel('Votre réponse 2').fill('FOOTBALL');
    await pinInput(page, 'Nouveau PIN (6 chiffres)').fill(NEW_PIN);
    await pinInput(page, 'Confirmez le nouveau PIN').fill(NEW_PIN);
    await page.getByRole('button', { name: 'Vérifier mes réponses' }).click();

    await expect(page.getByText('Demande enregistrée')).toBeVisible();
    await expect(page.getByText(/ancien PIN, la demande sera annulée/)).toBeVisible();
    // Rien n'est encore appliqué : l'ancien PIN fonctionne et annule la demande.
    await loginWithPhone(page, owner.phone);
    await expect(page.getByTestId('restaurant-name')).toBeVisible();
    await expect(
      api.call('/auth/staff/login', { body: { phone: owner.phone, pin: NEW_PIN } }),
    ).rejects.toThrow(/401/);
  });

  test('finalise une demande différée une fois l’échéance passée', async ({ page, api }) => {
    const owner = await api.ownerWithRestaurant('Resto Différé');
    await api.call('/auth/staff/recover/questions', {
      body: {
        phone: owner.phone,
        birthDate: { day: 12, month: 11, year: 1980 },
        recoveryAnswers: [
          { question: 'BIRTH_CITY', answer: 'Bafoussam' },
          { question: 'FAVORITE_SPORT', answer: 'Football' },
        ],
        newPin: NEW_PIN,
        newPinConfirm: NEW_PIN,
      },
    });
    await page.goto('/forgot');
    await page.getByRole('button', { name: 'Finaliser la récupération' }).click();
    await page.getByLabel('Numéro de téléphone').fill(owner.phone.replace('+237', ''));
    await pinInput(page, 'Nouveau PIN (6 chiffres)').fill(NEW_PIN);
    await page.getByRole('button', { name: 'Finaliser', exact: true }).click();
    // Trop tôt : la date d'effet est indiquée.
    await expect(page.getByTestId('form-error')).toContainText(
      'Cette demande sera disponible à partir du',
    );

    await makeRecoveryDue(owner.userId);
    await page.getByRole('button', { name: 'Finaliser', exact: true }).click();
    await expect(page.getByTestId('restaurant-name')).toHaveText('Resto Différé');
    await expect(
      api.call('/auth/staff/login', { body: { phone: owner.phone, pin: NEW_PIN } }),
    ).resolves.toBeTruthy();
  });

  test('alerte visible pour le titulaire connecté, annulable par « Ce n’est pas moi »', async ({
    page,
    api,
  }) => {
    const owner = await api.ownerWithRestaurant();
    await loginWithPhone(page, owner.phone);
    await expect(page.getByTestId('restaurant-name')).toBeVisible();

    // Quelqu'un d'autre lance une récupération pendant que le titulaire est connecté.
    await api.call('/auth/staff/recover/questions', {
      body: {
        phone: owner.phone,
        birthDate: { day: 12, month: 11, year: 1980 },
        recoveryAnswers: [
          { question: 'BIRTH_CITY', answer: 'Bafoussam' },
          { question: 'FAVORITE_SPORT', answer: 'Football' },
        ],
        newPin: '246813',
        newPinConfirm: '246813',
      },
    });
    await page.goto('/account');
    const alert = page.getByTestId('recovery-alert');
    await expect(alert).toContainText('Une demande de récupération est en cours');
    await alert.getByRole('button', { name: 'Ce n’est pas moi' }).click();
    await expect(alert).toBeHidden();
  });

  test('par email : un code permet de choisir un nouveau mot de passe', async ({ page, api }) => {
    const account = await api.registerByEmail('staff');
    await api.call('/restaurants', {
      body: { name: 'Resto Email', city: 'Douala' },
      token: account.accessToken,
    });
    await page.goto('/forgot');
    await page.getByRole('button', { name: 'Recevoir un code par email' }).click();
    await page.getByLabel('Adresse email').fill(account.email);
    await page.getByRole('button', { name: 'Envoyer le code' }).click();
    await expect(page.getByRole('status')).toContainText(account.email);

    await page.getByLabel('Code reçu par email').fill(await api.emailCode(account.email));
    await page.getByRole('button', { name: 'Mon mot de passe' }).click();
    await page.getByLabel('Nouveau mot de passe').fill('Nouveau-mdp-9');
    await page.getByRole('button', { name: 'Réinitialiser', exact: true }).click();
    await expect(page.getByText('Accès rétabli')).toBeVisible();
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.getByTestId('restaurant-name')).toHaveText('Resto Email');
    await expect(
      api.call('/auth/staff/login-email', { body: { email: account.email, password: PASSWORD } }),
    ).rejects.toThrow(/401/);
    await expect(
      api.call('/auth/staff/login-email', {
        body: { email: account.email, password: 'Nouveau-mdp-9' },
      }),
    ).resolves.toBeTruthy();
  });

  test('par email : un code erroné est refusé', async ({ page, api }) => {
    const account = await api.registerByEmail('staff');
    await page.goto('/forgot');
    await page.getByRole('button', { name: 'Recevoir un code par email' }).click();
    await page.getByLabel('Adresse email').fill(account.email);
    await page.getByRole('button', { name: 'Envoyer le code' }).click();
    const real = await api.emailCode(account.email);
    await page.getByLabel('Code reçu par email').fill(real === '000000' ? '111111' : '000000');
    await page.getByRole('button', { name: 'Mon mot de passe' }).click();
    await page.getByLabel('Nouveau mot de passe').fill('Nouveau-mdp-9');
    await page.getByRole('button', { name: 'Réinitialiser', exact: true }).click();
    await expect(page.getByTestId('form-error')).toHaveText('Code incorrect ou expiré.');
  });

  test('adresse inconnue : même message de succès (aucune fuite)', async ({ page }) => {
    await page.goto('/forgot');
    await page.getByRole('button', { name: 'Recevoir un code par email' }).click();
    await page.getByLabel('Adresse email').fill(uniqueEmail());
    await page.getByRole('button', { name: 'Envoyer le code' }).click();
    await expect(page.getByLabel('Code reçu par email')).toBeVisible();
  });
});
