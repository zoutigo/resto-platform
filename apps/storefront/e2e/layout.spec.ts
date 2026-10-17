import { expect, test } from '@resto/e2e-support';

test.describe('Ergonomie, langue et référencement', () => {
  test('aucun défilement horizontal sur l’accueil ni sur les écrans d’accès', async ({ page }) => {
    for (const path of ['/', '/login', '/register', '/forgot']) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  test('bascule français / anglais et mémorise le choix', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bienvenue');
    await page.getByRole('button', { name: 'EN' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome');
  });

  test('l’accueil est rendu côté serveur (titre, langue, description) pour le référencement', async ({
    request,
  }) => {
    const response = await request.get('/');
    const html = await response.text();
    expect(response.status()).toBe(200);
    expect(html).toContain('<html lang="fr"');
    expect(html).toContain('<title>Resto — Restaurants au Cameroun</title>');
    expect(html).toContain('name="description"');
  });

  test('page légère : peu de requêtes et de données pour l’accueil', async ({ page }) => {
    const sizes: number[] = [];
    page.on('response', async (response) => {
      const length = Number(response.headers()['content-length'] ?? 0);
      if (length) sizes.push(length);
    });
    await page.goto('/', { waitUntil: 'networkidle' });
    const total = sizes.reduce((a, b) => a + b, 0);
    // Compressé ou non, l'accueil doit rester raisonnable pour une connexion mobile chère.
    expect(total).toBeLessThan(1_500_000);
  });
});
