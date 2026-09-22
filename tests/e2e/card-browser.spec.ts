import { test, expect } from '@playwright/test';

/** A 1x1 PNG, small enough to paste and real enough for the browser to decode. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

for (const source of ['directory', 'import'] as const) {
  test(`a broken ${source} image falls back to an emblem and can be replaced`, async ({ page }) => {
    await page.route('**/cards/index.json', route => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ 'power-slash': 'broken.jpg' }),
    }));
    await page.route('**/cards/broken.jpg', route => route.fulfill({ contentType: 'image/jpeg', body: 'not an image' }));
    if (source === 'import') await page.addInitScript(() => {
      localStorage.setItem('tactical:card-art:power-slash', 'data:image/jpeg;base64,broken');
    });
    const indexLoaded = page.waitForResponse('**/cards/index.json');
    await page.goto('/');
    await indexLoaded;
    await page.waitForFunction(() => window.__engine && window.__engine.frames > 2);
    await page.evaluate(() => {
      const a = window.__engine!;
      a.select('kara');
      a.setCards('kara', ['power-slash']);
    });
    await page.getByTestId('open-loadout').click();
    const panel = page.getByTestId('loadout');
    const tile = panel.locator('[data-card="power-slash"] .face-art');
    await expect(tile.locator('> svg')).toBeVisible();
    await expect(tile.locator('img')).toHaveCount(0);
    await page.getByRole('button', { name: 'Inspect Power Slash', exact: true }).click();
    const enlarged = panel.locator('.face-expanded .face-art');
    await expect(enlarged.locator('> svg')).toBeVisible();
    await panel.getByTestId('art-file').setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: PIXEL });
    await expect(enlarged.locator('img')).toHaveAttribute('src', /^data:image\/jpeg/);
    await expect.poll(() => tile.locator('img').evaluateAll(images => images.length === 1 && (images[0] as HTMLImageElement).naturalWidth > 0)).toBe(true);
    await panel.getByTestId('clear-art').click();
    await expect(enlarged.locator('> svg')).toBeVisible();
    await expect(tile.locator('> svg')).toBeVisible();
  });
}

test('the card collection filters, inspects and swaps without leaking keyboard input to the game', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => window.__engine && window.__engine.frames > 2);
  await page.evaluate(() => {
    const a = window.__engine!;
    a.setDiceSpeed(0);
    a.select('kara');
    a.setCards('kara', ['power-slash', 'shield-wall', 'iron-stance', 'rallying-cry', 'unbroken', 'smoke-step']);
  });
  await page.getByTestId('open-loadout').click();
  const panel = page.getByTestId('loadout');
  await expect(panel.locator('.deck-slot')).toHaveCount(6);
  // The left leaf is her sheet: the six traits, and the numbers a blow is read against.
  const sheet = panel.getByTestId('loadout-sheet');
  await expect(sheet.locator('.sheet-trait')).toHaveCount(6);
  await expect(sheet.getByTestId('sheet-evasion')).toContainText(/\d/);
  await expect(sheet.getByTestId('sheet-thresholds')).toContainText(/Minor.*\d+.*Major.*\d+.*Severe/s);
  // Every card shows something without waiting on a fetch: a file from
  // `public/cards/` where the index names one, its own drawn emblem otherwise.
  // Which of the two depends on whether this machine has an art directory.
  await expect(panel.locator('.deck-slot .face-art > :is(svg, img)')).toHaveCount(6);
  // Beside the hand, face up and counted by no limit: what Kara has without choosing it.
  const granted = panel.getByTestId('granted-zone');
  await expect(granted.locator('.granted-slot')).toHaveCount(9);
  await expect(granted.locator('[data-card="rally-the-line"]')).toContainText('Given');
  await expect(panel).toContainText('5 / 5');
  await page.screenshot({ path: 'test-results/card-collection.png' });
  await page.getByRole('button', { name: 'Inspect Unbroken', exact: true }).click();
  await expect(panel.locator('.face-expanded')).toContainText('Unbroken');
  // While a card is held up to read, the binder's own way out is put away: Esc means the card here.
  await expect(page.getByTestId('close-loadout')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/card-inspect.png' });
  await page.keyboard.press('Escape');
  await expect(panel.locator('.card-lightbox')).toHaveCount(0);
  await expect(page.getByTestId('close-loadout')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Inspect Unbroken', exact: true })).toBeFocused();
  await expect(panel).toBeVisible();
  await page.getByRole('textbox', { name: 'Search cards' }).fill('iron');
  await expect(panel.locator('.deck-slot')).toHaveCount(1);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => window.__engine!.selected())).toBe('kara');
  await page.getByRole('textbox', { name: 'Search cards' }).fill('');
  await page.getByRole('combobox', { name: 'Domain' }).selectOption({ label: 'bulwark' });
  // Five of the six are bulwark; the sixth is the shadow card in the vault.
  await expect(panel.locator('.deck-slot')).toHaveCount(5);
  // What is always in play has no domain, so a domain filter puts it away.
  await expect(panel.getByTestId('granted-zone')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Domain' }).selectOption('all');
  const recall = panel.locator('[data-card="smoke-step"]').getByTestId('recall');
  await expect(recall).toBeDisabled();
  await panel.locator('[data-card="unbroken"]').getByTestId('pick-out').check();
  // The collection is a binder now: it turns rather than scrolls, and the vault is a later leaf
  // than the hand. Turn until the card is actually reachable rather than counting pages -- how many
  // there are depends on the size of the window and on how many cards are held.
  for (let turns = 0; turns < 8 && !(await recall.isVisible()); turns++) await panel.getByTestId('next-page').click();
  await recall.click();
  await expect(panel.locator('[data-card="unbroken"]').getByTestId('recall')).toBeVisible();
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
  await page.waitForFunction(() => window.__engine && window.__engine.frames > 2);
  await page.evaluate(() => {
    const a = window.__engine!;
    a.setDiceSpeed(0);
    a.select('kara');
    a.setCards('kara', ['power-slash', 'shield-wall', 'iron-stance', 'rallying-cry', 'unbroken']);
  });

  await page.getByTestId('open-loadout').click();
  const panel = page.getByTestId('loadout');
  await page.getByRole('button', { name: 'Inspect Power Slash', exact: true }).click();
  const enlarged = panel.locator('.face-expanded .face-art');

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
  await expect(panel.locator('.deck-slot[data-card="power-slash"] img')).toHaveAttribute('src', /^data:image\/jpeg/);
  // Its neighbours are untouched.
  await expect(panel.locator('.deck-slot[data-card="shield-wall"] img[src^="data:"]')).toHaveCount(0);

  // Imported art survives a reload: it lives in this browser, not in the page.
  await page.reload();
  await page.waitForFunction(() => window.__engine && window.__engine.frames > 2);
  await page.evaluate(() => {
    const a = window.__engine!;
    a.select('kara');
    a.setCards('kara', ['power-slash', 'shield-wall', 'iron-stance', 'rallying-cry', 'unbroken']);
  });
  await page.getByTestId('open-loadout').click();
  await expect(panel.locator('.deck-slot[data-card="power-slash"] img')).toHaveAttribute('src', /^data:image\/jpeg/);

  // Giving it back returns the card to whatever it showed before.
  await page.getByRole('button', { name: 'Inspect Power Slash', exact: true }).click();
  await panel.getByTestId('clear-art').click();
  await expect(panel.locator('.face-expanded .face-art img[src^="data:"]')).toHaveCount(0);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
