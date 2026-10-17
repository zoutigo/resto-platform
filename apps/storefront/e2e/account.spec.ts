import { PIN, expect, test, uniqueEmail, uniquePhone } from '@resto/e2e-support';
import { pinInput, signIn } from './helpers';

test.describe('Mon compte', () => {
  test('ajoute et confirme une adresse email avec le code reçu', async ({ page, api }) => {
    const customer = await api.registerCustomer();
    await signIn(page, customer.phone);
    await page.getByRole('link', { name: 'Mon compte' }).click();
    const email = uniqueEmail();
    await page.getByLabel('Adresse email').fill(email);
    await page.getByRole('button', { name: 'Ajouter une adresse email' }).click();
    await page.getByLabel('Code reçu par email').fill(await api.emailCode(email));
    await page.getByRole('button', { name: 'Confirmer l’adresse' }).click();
    await expect(page.locator('dd', { hasText: email })).toContainText('vérifié');
    await expect(page.getByRole('button', { name: 'Ajouter une adresse email' })).toHaveCount(0);
  });

  test('un compte email ajoute son numéro de téléphone', async ({ page, api }) => {
    const account = await api.registerByEmail('customer', { name: 'Awa Courriel' });
    await page.goto('/login');
    await page.getByRole('tab', { name: 'Email' }).click();
    await page.getByLabel('Adresse email').fill(account.email);
    await page.getByLabel('Mot de passe').fill(account.password);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await page.getByRole('link', { name: 'Mon compte' }).click();

    const phone = uniquePhone();
    await page.getByLabel('Numéro de téléphone').fill(phone.replace('+237', ''));
    await page.getByRole('button', { name: 'Ajouter un numéro de téléphone' }).click();
    await expect(page.getByText(phone)).toBeVisible();
    await expect(page.getByText('non vérifié')).toBeVisible();
  });

  test('génère un nouveau code de secours après confirmation du PIN', async ({ page, api }) => {
    const customer = await api.registerCustomer();
    await signIn(page, customer.phone);
    await page.getByRole('link', { name: 'Mon compte' }).click();
    await pinInput(page, 'PIN actuel').fill(PIN);
    await page.getByRole('button', { name: 'Générer un nouveau code de secours' }).click();
    const fresh = (await page.getByTestId('recovery-code').textContent())?.trim();
    expect(fresh).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){2}$/);
    expect(fresh).not.toBe(customer.recoveryCode);
  });

  test('un mauvais PIN empêche de générer un code', async ({ page, api }) => {
    const customer = await api.registerCustomer();
    await signIn(page, customer.phone);
    await page.getByRole('link', { name: 'Mon compte' }).click();
    await pinInput(page, 'PIN actuel').fill('000001');
    await page.getByRole('button', { name: 'Générer un nouveau code de secours' }).click();
    await expect(page.getByTestId('form-error')).toHaveText('Identifiants incorrects.');
    await expect(page.getByTestId('recovery-code')).toHaveCount(0);
  });
});
