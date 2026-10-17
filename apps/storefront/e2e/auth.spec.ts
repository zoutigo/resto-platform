import { PIN, expect, test, uniqueEmail, uniquePhone } from '@resto/e2e-support';
import { loginWithPhone, pinInput, registerCustomerThroughUi } from './helpers';

test.describe('Inscription et connexion du client', () => {
  test('crée son compte, est accueilli par son nom, garde sa session puis se déconnecte', async ({
    page,
  }) => {
    await registerCustomerThroughUi(page, uniquePhone());
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bonjour Awa Mbarga');

    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bonjour Awa Mbarga');

    await page.getByRole('link', { name: 'Mon compte' }).click();
    await expect(page.getByRole('heading', { name: 'Mon compte', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bienvenue');
    await expect(page.getByRole('link', { name: 'Connexion' })).toBeVisible();
    await page.goto('/account');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('se connecte avec téléphone + PIN', async ({ page, api }) => {
    const customer = await api.registerCustomer({ name: 'Marie Ebogo' });
    await loginWithPhone(page, customer.phone);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bonjour Marie Ebogo');
  });

  test('refuse un mauvais PIN avec un message clair', async ({ page, api }) => {
    const customer = await api.registerCustomer();
    await loginWithPhone(page, customer.phone, '000001');
    await expect(page.getByTestId('form-error')).toHaveText('Identifiants incorrects.');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('valide les champs avant tout envoi', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Numéro de téléphone').fill('abc');
    await pinInput(page).fill('1');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByText(/Numéro invalide/)).toBeVisible();
    await expect(page.getByText('Le PIN doit contenir exactement 6 chiffres.')).toBeVisible();
  });

  test('s’inscrit avec une adresse email : code reçu par email puis compte créé', async ({
    page,
    api,
  }) => {
    const email = uniqueEmail();
    await page.goto('/register');
    await page.getByRole('button', { name: 'S’inscrire avec une adresse email' }).click();
    await page.getByLabel('Nom complet').fill('Awa Email');
    await page.getByLabel('Adresse email').fill(email);
    await page.getByLabel('Mot de passe', { exact: true }).fill('Soleil-2026');
    await page.getByLabel('Confirmez le mot de passe').fill('Soleil-2026');
    await page.getByRole('button', { name: 'Recevoir un code' }).click();
    await expect(page.getByRole('status')).toContainText(email);

    await page.getByLabel('Code reçu par email').fill(await api.emailCode(email));
    await page.getByRole('button', { name: 'Valider le code' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bonjour Awa Email');
  });

  test('un mauvais code email est refusé', async ({ page, api }) => {
    const email = uniqueEmail();
    await page.goto('/register');
    await page.getByRole('button', { name: 'S’inscrire avec une adresse email' }).click();
    await page.getByLabel('Nom complet').fill('Awa Email');
    await page.getByLabel('Adresse email').fill(email);
    await page.getByLabel('Mot de passe', { exact: true }).fill('Soleil-2026');
    await page.getByLabel('Confirmez le mot de passe').fill('Soleil-2026');
    await page.getByRole('button', { name: 'Recevoir un code' }).click();
    const real = await api.emailCode(email);
    await page.getByLabel('Code reçu par email').fill(real === '000000' ? '111111' : '000000');
    await page.getByRole('button', { name: 'Valider le code' }).click();
    await expect(page.getByTestId('form-error')).toHaveText('Code incorrect ou expiré.');
  });

  test('se connecte par email + mot de passe', async ({ page, api }) => {
    const account = await api.registerByEmail('customer', { name: 'Awa Courriel' });
    await page.goto('/login');
    await page.getByRole('tab', { name: 'Email' }).click();
    await page.getByLabel('Adresse email').fill(account.email);
    await page.getByLabel('Mot de passe').fill(account.password);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bonjour Awa Courriel');
  });

  test('numéro déjà utilisé : message et pas de compte créé', async ({ page, api }) => {
    const existing = await api.registerCustomer();
    await page.goto('/register');
    await page.getByLabel('Nom complet').fill('Autre Personne');
    await page.getByLabel('Numéro de téléphone').fill(existing.phone.replace('+237', ''));
    await page.getByRole('button', { name: 'Continuer' }).click();
    await pinInput(page).fill('715204');
    await pinInput(page, 'Confirmez le PIN').fill('715204');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByLabel('Jour').selectOption('5');
    await page.getByLabel('Mois').selectOption('3');
    await page.getByLabel('Année').selectOption('1990');
    await page.getByLabel(/^Question 1/).selectOption('FAVORITE_ANIMAL');
    await page.getByLabel('Votre réponse 1').fill('lion');
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await expect(page.getByTestId('form-error')).toHaveText('Ce numéro est déjà utilisé.');
    await expect(page.getByTestId('recovery-code')).toHaveCount(0);
  });

  test('l’accueil est public ; le compte est protégé', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bienvenue');
    await expect(page.getByRole('link', { name: 'Connexion' })).toBeVisible();
    await page.goto('/account');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('pas de bouton Google quand Google n’est pas configuré', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('google-button')).toHaveCount(0);
  });
});

test.describe('Résilience des formulaires', () => {
  test('erreur serveur 500 : message général', async ({ page }) => {
    await page.route('**/auth/customer/login', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{"message":"server.error"}',
      }),
    );
    await loginWithPhone(page, uniquePhone());
    await expect(page.getByTestId('form-error')).toContainText('Le service rencontre un problème');
  });

  test('réseau coupé puis rétabli', async ({ page, api }) => {
    const customer = await api.registerCustomer({ name: 'Awa Réseau' });
    let offline = true;
    await page.route('**/auth/customer/login', (route) =>
      offline ? route.abort('failed') : route.continue(),
    );
    await loginWithPhone(page, customer.phone);
    await expect(page.getByTestId('form-error')).toContainText('Pas de connexion');
    offline = false;
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bonjour Awa Réseau');
  });

  test('trop de tentatives : délai d’attente indiqué', async ({ page, api }) => {
    const customer = await api.registerCustomer();
    await page.goto('/login');
    await page.getByLabel('Numéro de téléphone').fill(customer.phone.replace('+237', ''));
    for (let i = 0; i < 5; i++) {
      await pinInput(page).fill(`00000${i + 1}`);
      await page.getByRole('button', { name: 'Se connecter' }).click();
      await expect(page.getByTestId('form-error')).toBeVisible();
    }
    await pinInput(page).fill(PIN);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByTestId('form-error')).toContainText('Trop de tentatives');
  });
});
