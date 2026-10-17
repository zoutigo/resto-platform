import { type Page, expect } from '@playwright/test';
import { PIN, localPhone } from '@resto/e2e-support';

export const pinInput = (page: Page, label = 'Code PIN (6 chiffres)') =>
  page.getByLabel(label, { exact: true });

/** Remplit l'onglet « Téléphone » du formulaire de connexion et valide. */
export async function loginWithPhone(page: Page, phone: string, pin = PIN) {
  await page.goto('/login');
  await page.getByLabel('Numéro de téléphone').fill(localPhone(phone));
  await pinInput(page).fill(pin);
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

/** Parcourt les trois étapes d'inscription d'un restaurateur et valide le code de secours. */
export async function registerOwnerThroughUi(page: Page, phone: string, pin = PIN) {
  await page.goto('/register');
  await page.getByLabel('Prénom').fill('Paul');
  await page.getByLabel('Nom', { exact: true }).fill('Essomba');
  await page.getByLabel('Numéro de téléphone').fill(localPhone(phone));
  await page.getByRole('button', { name: 'Continuer' }).click();

  await pinInput(page).fill(pin);
  await pinInput(page, 'Confirmez le PIN').fill(pin);
  await page.getByRole('button', { name: 'Continuer' }).click();

  await page.getByLabel('Jour').selectOption('12');
  await page.getByLabel('Mois').selectOption('11');
  await page.getByLabel('Année').selectOption('1980');
  await page.getByLabel(/^Question 1/).selectOption('BIRTH_CITY');
  await page.getByLabel('Votre réponse 1').fill('Bafoussam');
  await page.getByLabel(/^Question 2/).selectOption('FAVORITE_SPORT');
  await page.getByLabel('Votre réponse 2').fill('Football');
  await page.getByRole('button', { name: 'Créer mon compte' }).click();

  const code = (await page.getByTestId('recovery-code').textContent())?.trim() ?? '';
  expect(code).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){2}$/);
  await page.getByLabel('J’ai noté mon code de secours').check();
  await page.getByRole('button', { name: 'Continuer' }).click();
  return code;
}

/** Se connecte et attend d'être réellement dans l'application (avant toute autre navigation). */
export async function signIn(page: Page, phone: string, pin = PIN) {
  await loginWithPhone(page, phone, pin);
  await expect(page.getByTestId('restaurant-name')).toBeVisible();
}
