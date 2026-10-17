import { NEW_PIN, PIN, expect, test, uniquePhone } from '@resto/e2e-support';
import { loginWithPhone, pinInput, registerOwnerThroughUi } from './helpers';

test.describe('Inscription et connexion du restaurateur', () => {
  test('crée son compte, son restaurant, retrouve sa session au rechargement puis se déconnecte', async ({
    page,
  }) => {
    const phone = uniquePhone();
    await registerOwnerThroughUi(page, phone);

    // Onboarding : création du restaurant.
    await expect(page.getByRole('heading', { name: 'Créez votre restaurant' })).toBeVisible();
    await page.getByLabel('Nom du restaurant').fill('Chez Mama Africa');
    await page.getByLabel('Ville').fill('Douala');
    await page.getByRole('button', { name: 'Créer mon restaurant' }).click();

    // Tableau de bord.
    await expect(page.getByTestId('restaurant-name')).toHaveText('Chez Mama Africa');
    await expect(page.getByTestId('role')).toContainText('Propriétaire');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Paul Essomba');

    // La session survit à un rechargement (cookie httpOnly + rafraîchissement du jeton).
    await page.reload();
    await expect(page.getByTestId('restaurant-name')).toHaveText('Chez Mama Africa');

    // Déconnexion depuis « Compte ».
    await page.getByRole('link', { name: 'Compte' }).first().click();
    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('se connecte avec téléphone + PIN et arrive sur son restaurant', async ({ page, api }) => {
    const owner = await api.ownerWithRestaurant('Le Palmier');
    await loginWithPhone(page, owner.phone);
    await expect(page.getByTestId('restaurant-name')).toHaveText('Le Palmier');
  });

  test('refuse un mauvais PIN avec un message clair et reste sur la page', async ({
    page,
    api,
  }) => {
    const owner = await api.ownerWithRestaurant();
    await loginWithPhone(page, owner.phone, '000001');
    await expect(page.getByTestId('form-error')).toHaveText('Identifiants incorrects.');
    await expect(page).toHaveURL(/\/login$/);
    // Un toast annonce aussi l'échec.
    await expect(page.getByText('Identifiants incorrects.').first()).toBeVisible();
  });

  test('valide les champs à la saisie avant tout envoi', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Numéro de téléphone').fill('12345');
    await pinInput(page).fill('12');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByText(/Numéro invalide/)).toBeVisible();
    await expect(page.getByText('Le PIN doit contenir exactement 6 chiffres.')).toBeVisible();
  });

  test('se connecte par email + mot de passe', async ({ page, api }) => {
    const account = await api.registerByEmail('staff');
    const { accessToken } = account;
    await api.call('/restaurants', {
      body: { name: 'Café du Port', city: 'Douala' },
      token: accessToken,
    });
    await page.goto('/login');
    await page.getByRole('tab', { name: 'Email' }).click();
    await page.getByLabel('Adresse email').fill(account.email);
    await page.getByLabel('Mot de passe').fill(account.password);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByTestId('restaurant-name')).toHaveText('Café du Port');
  });

  test('un connecté qui ouvre /login est renvoyé à son restaurant', async ({ page, api }) => {
    const owner = await api.ownerWithRestaurant('Chez Awa');
    await loginWithPhone(page, owner.phone);
    await expect(page.getByTestId('restaurant-name')).toHaveText('Chez Awa');
    await page.goto('/login');
    await expect(page.getByTestId('restaurant-name')).toHaveText('Chez Awa');
  });

  test('un visiteur non connecté est renvoyé vers la connexion', async ({ page }) => {
    for (const path of ['/', '/team', '/account', '/onboarding']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    }
  });

  test('sans restaurant, un compte tout neuf est guidé vers la création', async ({ page, api }) => {
    const owner = await api.registerOwner();
    await loginWithPhone(page, owner.phone);
    await expect(page.getByRole('heading', { name: 'Créez votre restaurant' })).toBeVisible();
    await page.goto('/team');
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test('numéro déjà utilisé à l’inscription : message et pas de passage à la suite', async ({
    page,
    api,
  }) => {
    const existing = await api.registerOwner();
    await page.goto('/register');
    await page.getByLabel('Prénom').fill('Paul');
    await page.getByLabel('Nom', { exact: true }).fill('Essomba');
    await page.getByLabel('Numéro de téléphone').fill(existing.phone.replace('+237', ''));
    await page.getByRole('button', { name: 'Continuer' }).click();
    await pinInput(page).fill(NEW_PIN);
    await pinInput(page, 'Confirmez le PIN').fill(NEW_PIN);
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByLabel('Jour').selectOption('12');
    await page.getByLabel('Mois').selectOption('11');
    await page.getByLabel('Année').selectOption('1980');
    await page.getByLabel(/^Question 1/).selectOption('BIRTH_CITY');
    await page.getByLabel('Votre réponse 1').fill('Bafoussam');
    await page.getByLabel(/^Question 2/).selectOption('FAVORITE_SPORT');
    await page.getByLabel('Votre réponse 2').fill('Football');
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await expect(page.getByTestId('form-error')).toHaveText('Ce numéro est déjà utilisé.');
    await expect(page.getByTestId('recovery-code')).toHaveCount(0);
  });
});

test.describe('Résilience du formulaire de connexion', () => {
  test('erreur serveur 500 : message général et toast', async ({ page }) => {
    await page.route('**/auth/staff/login', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{"message":"server.error"}',
      }),
    );
    await loginWithPhone(page, uniquePhone());
    await expect(page.getByTestId('form-error')).toContainText('Le service rencontre un problème');
  });

  test('réseau coupé : message « pas de connexion », puis succès au nouvel essai', async ({
    page,
    api,
  }) => {
    const owner = await api.ownerWithRestaurant('Resto Réseau');
    let offline = true;
    await page.route('**/auth/staff/login', (route) =>
      offline ? route.abort('failed') : route.continue(),
    );
    await loginWithPhone(page, owner.phone);
    await expect(page.getByTestId('form-error')).toContainText('Pas de connexion');
    offline = false;
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByTestId('restaurant-name')).toHaveText('Resto Réseau');
  });

  test('trop de tentatives : indique le délai d’attente', async ({ page, api }) => {
    const owner = await api.ownerWithRestaurant();
    await page.goto('/login');
    await page.getByLabel('Numéro de téléphone').fill(owner.phone.replace('+237', ''));
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
