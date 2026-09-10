import { test, expect } from '@playwright/test';

/** A 1x1 PNG, small enough to paste and real enough for the browser to decode. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

for (const source of ['directory', 'import'] as const) {
  test(`a broken ${source} image falls back to an emblem and can be replaced`, async ({ page }) => {
    await page.route('**/cards/index.json', route => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ 'bare-bones': 'broken.jpg' }),
    }));
    await page.route('**/cards/broken.jpg', route => route.fulfill({ contentType: 'image/jpeg', body: 'not an image' }));
    if (source === 'import') await page.addInitScript(() => {
      localStorage.setItem('polyheart:card-art:bare-bones', 'data:image/jpeg;base64,broken');
    });
    const indexLoaded = page.waitForResponse('**/cards/index.json');
    await page.goto('/');
    await indexLoaded;
    await page.waitForFunction(() => window.__polyheart && window.__polyheart.frames > 2);
    await page.evaluate(() => {
      const a = window.__polyheart!;
      a.select('kara');
      a.setCards('kara', ['bare-bones']);
    });
    await page.getByTestId('open-loadout').click();
    const panel = page.getByTestId('loadout');
    const tile = panel.locator('[data-card="bare-bones"] .dh-art');
    await expect(tile.locator('svg')).toBeVisible();
    await expect(tile.locator('img')).toHaveCount(0);
    await page.getByRole('button', { name: 'Inspect Bare Bones', exact: true }).click();
    const enlarged = panel.locator('.dh-card-expanded .dh-art');
    await expect(enlarged.locator('svg')).toBeVisible();
    await panel.getByTestId('art-file').setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: PIXEL });
    await expect(enlarged.locator('img')).toHaveAttribute('src', /^data:image\/jpeg/);
    await expect.poll(() => tile.locator('img').evaluateAll(images => images.length === 1 && (images[0] as HTMLImageElement).naturalWidth > 0)).toBe(true);
    await panel.getByTestId('clear-art').click();
    await expect(enlarged.locator('svg')).toBeVisible();
    await expect(tile.locator('svg')).toBeVisible();
  });
}

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
  // Every card shows something without waiting on a fetch: a file from
  // `public/cards/` where the index names one, its own drawn emblem otherwise.
  // Which of the two depends on whether this machine has an art directory.
  await expect(panel.locator('.dh-art > :is(svg, img)')).toHaveCount(6);
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

test('imports custom art for one card, and gives it back', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => window.__polyheart && window.__polyheart.frames > 2);
  await page.evaluate(() => {
    const a = window.__polyheart!;
    a.setDiceSpeed(0);
    a.select('kara');
    a.setCards('kara', ['bare-bones', 'get-back-up', 'forceful-push', 'i-am-your-shield', 'not-good-enough']);
  });

  await page.getByTestId('open-loadout').click();
  const panel = page.getByTestId('loadout');
  await page.getByRole('button', { name: 'Inspect Bare Bones', exact: true }).click();
  const enlarged = panel.locator('.dh-card-expanded .dh-art');

  // Whatever it shows now, it is not something this test chose.
  const before = await enlarged.locator('img').count() > 0
    ? await enlarged.locator('img').getAttribute('src')
    : null;
  expect(before?.startsWith('data:')).not.toBe(true);

  await panel.getByTestId('art-file').setInputFiles({ name: 'mine.png', mimeType: 'image/png', buffer: PIXEL });

  // The picture the player chose, kept in this browser and shown at once.
  await expect(enlarged.locator('img')).toHaveAttribute('src', /^data:image\/jpeg/);
  await page.screenshot({ path: 'test-results/card-import.png' });

  // And on the tile behind the enlarged view, not only in the reader.
  await page.keyboard.press('Escape');
  await expect(panel.locator('.deck-slot[data-card="bare-bones"] img')).toHaveAttribute('src', /^data:image\/jpeg/);
  // Its neighbours are untouched.
  await expect(panel.locator('.deck-slot[data-card="get-back-up"] img[src^="data:"]')).toHaveCount(0);

  // Imported art survives a reload: it lives in this browser, not in the page.
  await page.reload();
  await page.waitForFunction(() => window.__polyheart && window.__polyheart.frames > 2);
  await page.evaluate(() => {
    const a = window.__polyheart!;
    a.select('kara');
    a.setCards('kara', ['bare-bones', 'get-back-up', 'forceful-push', 'i-am-your-shield', 'not-good-enough']);
  });
  await page.getByTestId('open-loadout').click();
  await expect(panel.locator('.deck-slot[data-card="bare-bones"] img')).toHaveAttribute('src', /^data:image\/jpeg/);

  // Giving it back returns the card to whatever it showed before.
  await page.getByRole('button', { name: 'Inspect Bare Bones', exact: true }).click();
  await panel.getByTestId('clear-art').click();
  await expect(panel.locator('.dh-card-expanded .dh-art img[src^="data:"]')).toHaveCount(0);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
