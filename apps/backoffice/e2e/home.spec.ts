import { expect, test } from '@playwright/test';

test('la page d’accueil s’affiche sans erreur, sans défilement horizontal', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Back-office restaurant' }),
  ).toBeVisible();
  await expect(page.getByText(/FCFA/)).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});
