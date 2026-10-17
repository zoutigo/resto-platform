import { NEW_PIN, expect, test } from '@resto/e2e-support';
import { loginWithPhone, pinInput, signIn } from './helpers';

const memberRow = (page: import('@playwright/test').Page, phone: string) =>
  page.getByTestId(`member-${phone}`);

test.describe('Équipe', () => {
  test('ajoute un serveur, affiche son PIN temporaire une fois, et il doit le remplacer à sa première connexion', async ({
    page,
    api,
  }) => {
    const owner = await api.ownerWithRestaurant('Chez Mama');
    await loginWithPhone(page, owner.phone);
    await page.getByRole('link', { name: 'Équipe' }).first().click();
    await expect(page.getByRole('heading', { name: 'Équipe', level: 1 })).toBeVisible();
    // Seul le propriétaire figure dans la liste.
    await expect(page.getByRole('listitem').filter({ hasText: 'Propriétaire' })).toHaveCount(1);
    await expect(page.getByRole('list', { name: 'Équipe' }).getByRole('listitem')).toHaveCount(1);

    const phone = `6${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    await page.getByLabel('Nom complet').fill('Jean Nkoulou');
    await page.getByLabel('Numéro de téléphone').fill(phone);
    await page.getByLabel('Rôle', { exact: true }).selectOption('WAITER');
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();

    // Le PIN temporaire n'apparaît qu'une fois, dans une boîte de dialogue.
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'PIN temporaire' })).toBeVisible();
    const temporaryPin = (await dialog.getByTestId('temporary-pin').textContent())?.trim() ?? '';
    expect(temporaryPin).toMatch(/^\d{6}$/);
    await dialog.getByRole('button', { name: 'Fermer' }).first().click();
    await expect(dialog).toBeHidden();

    const row = memberRow(page, `+237${phone}`);
    await expect(row).toContainText('Jean Nkoulou');
    await expect(row).toContainText('Serveur');
    await expect(row).toContainText('PIN temporaire');
    await expect(page.getByText(temporaryPin)).toHaveCount(0);

    // Déconnexion du propriétaire.
    await page.getByRole('link', { name: 'Compte' }).first().click();
    await page.getByRole('button', { name: 'Se déconnecter' }).click();

    // Le serveur se connecte avec le PIN temporaire : il est forcé de le remplacer.
    await loginWithPhone(page, `+237${phone}`, temporaryPin);
    await expect(page).toHaveURL(/\/change-pin$/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/change-pin$/);
    await pinInput(page, 'PIN actuel').fill(temporaryPin);
    await pinInput(page, 'Nouveau PIN (6 chiffres)').fill(NEW_PIN);
    await pinInput(page, 'Confirmez le nouveau PIN').fill(NEW_PIN);
    await page.getByRole('button', { name: 'Changer mon PIN' }).click();

    await expect(page.getByTestId('restaurant-name')).toHaveText('Chez Mama');
    await expect(page.getByTestId('role')).toContainText('Serveur');
    // Un serveur ne voit pas l'équipe et ne peut pas l'ouvrir.
    await expect(page.getByRole('link', { name: 'Équipe' })).toHaveCount(0);
    await page.goto('/team');
    await expect(page).toHaveURL(/\/$/);
  });

  test('réinitialise le PIN d’un employé : nouveau PIN affiché, l’ancien ne marche plus', async ({
    page,
    api,
  }) => {
    const owner = await api.ownerWithRestaurant();
    const staff = await api.addStaff(owner, 'CASHIER', 'Marie Ebogo');
    await signIn(page, owner.phone);
    await page.goto('/team');
    await memberRow(page, staff.phone)
      .getByRole('button', { name: 'Réinitialiser le PIN' })
      .click();

    const dialog = page.getByRole('dialog');
    const fresh = (await dialog.getByTestId('temporary-pin').textContent())?.trim() ?? '';
    expect(fresh).toMatch(/^\d{6}$/);
    expect(fresh).not.toBe(staff.temporaryPin);
    await dialog.getByRole('button', { name: 'Fermer' }).first().click();

    await expect(
      api.call('/auth/staff/login', { body: { phone: staff.phone, pin: staff.temporaryPin } }),
    ).rejects.toThrow(/401/);
    await expect(
      api.call('/auth/staff/login', { body: { phone: staff.phone, pin: fresh } }),
    ).resolves.toBeTruthy();
  });

  test('change le rôle d’un employé', async ({ page, api }) => {
    const owner = await api.ownerWithRestaurant();
    const staff = await api.addStaff(owner, 'WAITER');
    await signIn(page, owner.phone);
    await page.goto('/team');
    await memberRow(page, staff.phone)
      .getByLabel(/^Rôle — /)
      .selectOption('CASHIER');
    await expect(memberRow(page, staff.phone)).toContainText('Caissier');
    await page.reload();
    await expect(memberRow(page, staff.phone)).toContainText('Caissier');
  });

  test('retire un employé après confirmation : il perd l’accès au restaurant', async ({
    page,
    api,
  }) => {
    const owner = await api.ownerWithRestaurant();
    const staff = await api.addStaff(owner, 'WAITER', 'Paul Biya');
    const active = await api.activateStaff(staff);
    await signIn(page, owner.phone);
    await page.goto('/team');
    await memberRow(page, staff.phone).getByRole('button', { name: 'Retirer' }).click();
    await expect(page.getByRole('dialog')).toContainText('Retirer Paul Biya de l’équipe ?');
    await page.getByRole('dialog').getByRole('button', { name: 'Retirer' }).click();
    await expect(memberRow(page, staff.phone)).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Équipe' }).getByRole('listitem')).toHaveCount(1);

    const login = await api.call<{ accessToken: string }>('/auth/staff/login', { body: active });
    await expect(
      api.call(`/restaurants/${owner.restaurantId}`, { token: login.accessToken }),
    ).rejects.toThrow(/404/);
  });

  test('un gérant gère le service mais ne peut proposer ni gérant ni propriétaire', async ({
    page,
    api,
  }) => {
    const owner = await api.ownerWithRestaurant();
    const supervisor = await api.activateStaff(
      await api.addStaff(owner, 'SUPERVISOR', 'Gérant Un'),
    );
    await signIn(page, supervisor.phone, supervisor.pin);
    await page.getByRole('link', { name: 'Équipe' }).first().click();
    await expect(page.getByLabel('Rôle', { exact: true }).locator('option')).toHaveText([
      'Serveur',
      'Caissier',
      'Cuisinier',
    ]);
    // Le propriétaire figure dans la liste mais sans aucune action possible.
    await expect(page.getByRole('listitem').filter({ hasText: 'Propriétaire' })).not.toContainText(
      'Retirer',
    );
  });

  test('numéro déjà dans l’équipe : message d’erreur', async ({ page, api }) => {
    const owner = await api.ownerWithRestaurant();
    const staff = await api.addStaff(owner, 'WAITER');
    await signIn(page, owner.phone);
    await page.goto('/team');
    await page.getByLabel('Nom complet').fill('Doublon Total');
    await page.getByLabel('Numéro de téléphone').fill(staff.phone.replace('+237', ''));
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await expect(page.getByTestId('form-error')).toHaveText(
      'Cette personne fait déjà partie de l’équipe.',
    );
  });

  test('refuse un nom ou un numéro invalide sans appel serveur', async ({ page, api }) => {
    const owner = await api.ownerWithRestaurant();
    await signIn(page, owner.phone);
    await page.goto('/team');
    await page.getByLabel('Nom complet').fill('J');
    await page.getByLabel('Numéro de téléphone').fill('123');
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await expect(page.getByText('Saisissez au moins 2 caractères.')).toBeVisible();
    await expect(page.getByText(/Numéro invalide/)).toBeVisible();
  });
});
