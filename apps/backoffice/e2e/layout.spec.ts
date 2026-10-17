import { expect, test } from '@resto/e2e-support';
import { loginWithPhone } from './helpers';

test.describe('Ergonomie mobile / desktop', () => {
  test('navigation adaptée au format : barre basse sur mobile, menu latéral sur grand écran', async ({
    page,
    api,
  }, testInfo) => {
    const owner = await api.ownerWithRestaurant();
    await loginWithPhone(page, owner.phone);
    await expect(page.getByTestId('restaurant-name')).toBeVisible();

    const nav = page.getByRole('navigation', { name: 'Navigation principale' });
    await expect(nav).toHaveCount(1); // un seul est visible à la fois
    const box = await nav.boundingBox();
    const viewport = page.viewportSize()!;
    if (testInfo.project.name === 'mobile') {
      // Barre fixée en bas de l'écran, sur toute la largeur.
      expect(box!.y + box!.height).toBeGreaterThan(viewport.height - 2);
      expect(box!.width).toBeGreaterThan(viewport.width - 2);
    } else {
      // Menu latéral à gauche.
      expect(box!.x).toBeLessThan(40);
      expect(box!.width).toBeLessThan(300);
    }
    for (const label of ['Tableau de bord', 'Équipe', 'Compte']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
  });

  test('aucun défilement horizontal, cibles tactiles confortables', async ({ page }) => {
    await page.goto('/login');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    for (const button of await page.getByRole('button').all()) {
      const box = await button.boundingBox();
      if (box) expect(box.height).toBeGreaterThanOrEqual(28);
    }
  });

  test('bascule français / anglais et mémorise le choix', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
    await page.getByRole('button', { name: 'EN' }).click();
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    await expect(page.getByLabel('Phone number')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    await page.getByRole('button', { name: 'FR' }).click();
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
  });

  test('les messages d’erreur suivent la langue choisie', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'EN' }).click();
    await page.getByLabel('Phone number').fill('12');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByText(/Invalid number/)).toBeVisible();
  });
});
