import { test, expect } from '@playwright/test';

test('the card collection filters, inspects and swaps without leaking keyboard input to the game', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => window.__polyheart && window.__polyheart.frames > 2);
  await page.evaluate(() => {
    const a = window.__polyheart!;
    a.setDiceSpeed(0);
    a.select('kara');
    a.setCards('kara', ['bare-bones', 'get-back-up', 'forceful-push', 'i-am-your-shield', 'not-good-enough', 'reckless']);
  });
  await page.getByTestId('open-loadout').click();
  const panel = page.getByTestId('loadout');
  await expect(panel.locator('.deck-slot')).toHaveCount(6);
  // Every card draws its own emblem: no files to fetch, so nothing to wait for.
  await expect(panel.locator('.dh-art svg')).toHaveCount(6);
  await page.screenshot({ path: 'test-results/card-collection.png' });
  await page.getByRole('button', { name: 'Inspect Not Good Enough', exact: true }).click();
  await expect(panel.locator('.dh-card-expanded')).toContainText('Not Good Enough');
  await page.screenshot({ path: 'test-results/card-inspect.png' });
  await page.keyboard.press('Escape');
  await expect(panel.locator('.card-lightbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Inspect Not Good Enough', exact: true })).toBeFocused();
  await expect(panel).toBeVisible();
  await page.getByRole('textbox', { name: 'Search cards' }).fill('forceful');
  await expect(panel.locator('.deck-slot')).toHaveCount(1);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => window.__polyheart!.selected())).toBe('kara');
  await page.getByRole('textbox', { name: 'Search cards' }).fill('');
  await page.getByRole('combobox', { name: 'Domain' }).selectOption({ label: 'blade' });
  await expect(panel.locator('.deck-slot')).toHaveCount(3);
  await page.getByRole('combobox', { name: 'Domain' }).selectOption('all');
  const recall = panel.locator('[data-card="reckless"]').getByTestId('recall');
  await expect(recall).toBeDisabled();
  await panel.locator('[data-card="not-good-enough"]').getByTestId('pick-out').check();
  await recall.click();
  await expect(panel.locator('[data-card="not-good-enough"]').getByTestId('recall')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel).toBeVisible();
  expect(await panel.evaluate(n => n.scrollWidth <= n.clientWidth)).toBe(true);
  await panel.locator('.deck-scroll').evaluate(n => { n.scrollTop = 0; });
  await page.screenshot({ path: 'test-results/card-collection-mobile.png' });
  await page.getByTestId('close-loadout').click();
  await expect(panel).toHaveCount(0);
  expect(errors).toEqual([]);
});
