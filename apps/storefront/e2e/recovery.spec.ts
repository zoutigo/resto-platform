import { NEW_PIN, PIN, expect, test } from '@resto/e2e-support';
import { pinInput } from './helpers';

test.describe('PIN oublié', () => {
  test('avec le code de secours : nouveau PIN et nouveau code', async ({ page, api }) => {
    const customer = await api.registerCustomer({ name: 'Awa Secours' });
    await page.goto('/forgot');
    await page.getByRole('button', { name: 'J’ai mon code de secours' }).click();
    await page.getByLabel('Numéro de téléphone').fill(customer.phone.replace('+237', ''));
    await page.getByLabel('Code de secours').fill(customer.recoveryCode);
    await pinInput(page, 'Nouveau PIN (6 chiffres)').fill(NEW_PIN);
    await pinInput(page, 'Confirmez le nouveau PIN').fill(NEW_PIN);
    await page.getByRole('button', { name: 'Réinitialiser mon PIN' }).click();

    const next = (await page.getByTestId('recovery-code').textContent())?.trim();
    expect(next).not.toBe(customer.recoveryCode);
    await page.getByLabel('J’ai noté mon code de secours').check();
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bonjour Awa Secours');

    await expect(
      api.call('/auth/customer/login', { body: { phone: customer.phone, pin: PIN } }),
    ).rejects.toThrow(/401/);
  });

  test('avec les questions secrètes : accès rétabli tout de suite, compte restreint 48 h', async ({
    page,
    api,
  }) => {
    const customer = await api.registerCustomer({ name: 'Awa Questions' });
    await page.goto('/forgot');
    await page.getByRole('button', { name: 'Répondre à mes questions secrètes' }).click();
    await page.getByLabel('Numéro de téléphone').fill(customer.phone.replace('+237', ''));
    await page.getByLabel('Jour').selectOption('5');
    await page.getByLabel('Mois').selectOption('3');
    await page.getByLabel('Année').selectOption('1990');
    await page.getByLabel(/^Question 1/).selectOption('BIRTH_CITY');
    await page.getByLabel('Votre réponse 1').fill(' douala ');
    await pinInput(page, 'Nouveau PIN (6 chiffres)').fill(NEW_PIN);
    await pinInput(page, 'Confirmez le nouveau PIN').fill(NEW_PIN);
    await page.getByRole('button', { name: 'Vérifier mes réponses' }).click();

    await expect(page.getByText(/certaines actions sont limitées pendant 48 h/)).toBeVisible();
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bonjour Awa Questions');
    await page.getByRole('link', { name: 'Mon compte' }).click();
    await expect(
      page.getByText('Compte restreint pendant 48 h après une récupération.'),
    ).toBeVisible();
  });

  test('de mauvaises réponses sont refusées sans rien révéler', async ({ page, api }) => {
    const customer = await api.registerCustomer();
    await page.goto('/forgot');
    await page.getByRole('button', { name: 'Répondre à mes questions secrètes' }).click();
    await page.getByLabel('Numéro de téléphone').fill(customer.phone.replace('+237', ''));
    await page.getByLabel('Jour').selectOption('6');
    await page.getByLabel('Mois').selectOption('3');
    await page.getByLabel('Année').selectOption('1990');
    await page.getByLabel(/^Question 1/).selectOption('BIRTH_CITY');
    await page.getByLabel('Votre réponse 1').fill('Douala');
    await pinInput(page, 'Nouveau PIN (6 chiffres)').fill(NEW_PIN);
    await pinInput(page, 'Confirmez le nouveau PIN').fill(NEW_PIN);
    await page.getByRole('button', { name: 'Vérifier mes réponses' }).click();
    await expect(page.getByTestId('form-error')).toContainText('Informations incorrectes');
    await expect(
      api.call('/auth/customer/login', { body: { phone: customer.phone, pin: PIN } }),
    ).resolves.toBeTruthy();
  });

  test('par email, pour un compte « téléphone + PIN » ayant ajouté son adresse', async ({
    page,
    api,
  }) => {
    const customer = await api.registerCustomer({ name: 'Awa Mixte' });
    const email = `mixte${Date.now()}@example.cm`;
    await api.call('/auth/customer/email/add', { body: { email }, token: customer.accessToken });
    await api.call('/auth/customer/email/confirm', {
      body: { email, code: await api.emailCode(email) },
      token: customer.accessToken,
    });

    await page.goto('/forgot');
    await page.getByRole('button', { name: 'Recevoir un code par email' }).click();
    await page.getByLabel('Adresse email').fill(email);
    await page.getByRole('button', { name: 'Envoyer le code' }).click();
    // L'envoi précédent (confirmation) a déjà produit un code : on attend le nouveau message.
    await expect(page.getByLabel('Code reçu par email')).toBeVisible();
    const codes = await api.call<{ code: string }[]>(
      `/__test/emails?to=${encodeURIComponent(email)}`,
    );
    await page.getByLabel('Code reçu par email').fill(codes.at(-1)!.code);
    await pinInput(page, 'Nouveau PIN (6 chiffres)').fill(NEW_PIN);
    await pinInput(page, 'Confirmez le nouveau PIN').fill(NEW_PIN);
    await page.getByRole('button', { name: 'Réinitialiser', exact: true }).click();
    await expect(page.getByText('Accès rétabli')).toBeVisible();
    await expect(
      api.call('/auth/customer/login', { body: { phone: customer.phone, pin: NEW_PIN } }),
    ).resolves.toBeTruthy();
  });
});
