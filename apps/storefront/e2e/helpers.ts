import { type Page, expect } from '@playwright/test';
import { PIN, localPhone } from '@resto/e2e-support';

export const pinInput = (page: Page, label = 'Code PIN (6 chiffres)') =>
  page.getByLabel(label, { exact: true });

/** Connexion par téléphone + PIN depuis la page /login. */
export async function loginWithPhone(page: Page, phone: string, pin = PIN) {
  await page.goto('/login');
  await page.getByLabel('Numéro de téléphone').fill(localPhone(phone));
  await pinInput(page).fill(pin);
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

/** Inscription client en trois étapes puis validation du code de secours. */
export async function registerCustomerThroughUi(
  page: Page,
  phone: string,
  name = 'Awa Mbarga',
  pin = PIN,
) {
  await page.goto('/register');
  await page.getByLabel('Nom complet').fill(name);
  await page.getByLabel('Numéro de téléphone').fill(localPhone(phone));
  await page.getByRole('button', { name: 'Continuer' }).click();

  await pinInput(page).fill(pin);
  await pinInput(page, 'Confirmez le PIN').fill(pin);
  await page.getByRole('button', { name: 'Continuer' }).click();

  await page.getByLabel('Jour').selectOption('5');
  await page.getByLabel('Mois').selectOption('3');
  await page.getByLabel('Année').selectOption('1990');
  await page.getByLabel(/^Question 1/).selectOption('BIRTH_CITY');
  await page.getByLabel('Votre réponse 1').fill('Douala');
  await page.getByRole('button', { name: 'Créer mon compte' }).click();

  const code = (await page.getByTestId('recovery-code').textContent())?.trim() ?? '';
  expect(code).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){2}$/);
  await page.getByLabel('J’ai noté mon code de secours').check();
  await page.getByRole('button', { name: 'Continuer' }).click();
  return code;
}

/** Se connecte et attend l'arrivée sur l'accueil (évite de naviguer pendant la redirection). */
export async function signIn(page: Page, phone: string, pin = PIN) {
  await loginWithPhone(page, phone, pin);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Bonjour');
}
