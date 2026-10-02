import { test, expect, type Page } from './fixtures';

/**
 * Art made with AI, marked wherever the editor shows a picture of it: a red AI badge in the corner, a
 * red note in the bottom-right corner while it is hovered, and a menu - from the badge, or a right-click
 * on the picture - that changes the mark for every project (`AiMark.tsx`, `art-provenance.ts`). The
 * tests' own server keeps no marks, so the change is stood in for here and its refusal read after.
 */

async function editing(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setMode('edit'));
}

test('the strip, the Models page and the Cards page mark AI art, and a mark is changed for good from any of them', async ({ page }) => {
  // No card illustrations from the printed material on this machine, whatever it holds: every card draws its emblem.
  await page.route('**/cards/index.json', (route) => route.fulfill({ json: {} }));
  await editing(page);
  const sent: unknown[] = [];
  await page.route('**/__art/provenance', async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: {} });
  });

  // The props in the Terrain strip: every model is AI generated to start.
  await page.getByTestId('mode-terrain').click();
  const strip = page.getByTestId('terrain-library');
  await strip.locator('[data-tab="props"]').click();
  const card = strip.locator('.ph-card[data-item="barrel-prop"]');
  const badge = card.getByTestId('ai-badge');
  await expect(badge).toHaveAttribute('data-provenance', 'ai-generated');
  await expect(badge).toHaveAttribute('data-art', 'model:barrel-prop');
  // Hovered, a red note in the corner says what it is.
  await card.locator('.ph-thumb').hover();
  await expect(page.getByTestId('ai-note')).toHaveText('AI Generated');
  await page.screenshot({ path: 'test-results/ai-marks-strip.png' });

  // The badge opens the menu; AI Assisted is kept, and the badge and the note say so.
  await badge.click();
  await page.getByTestId('ai-mark-ai-assisted').click();
  await expect(badge).toHaveAttribute('data-provenance', 'ai-assisted');
  await expect(badge).toHaveText('AI');
  await card.locator('.ph-thumb').hover();
  // Assisted: the note in yellow rather than red.
  await expect(page.getByTestId('ai-note')).toHaveText('AI Assisted');
  const yellow = await page.getByTestId('ai-note').evaluate((el) => getComputedStyle(el).color.match(/\d+/g)!.map(Number));
  expect(yellow[0]!).toBeGreaterThan(180);
  expect(yellow[1]!).toBeGreaterThan(140);
  expect(yellow[2]!).toBeLessThan(90);
  await page.screenshot({ path: 'test-results/ai-marks-assisted.png' });
  // Human made: a green tag that says so, and no note.
  await badge.click();
  await page.getByTestId('ai-mark-human-made').click();
  await expect(badge).toHaveAttribute('data-provenance', 'human-made');
  await expect(badge).toHaveText('Human');
  const green = await badge.evaluate((el) => getComputedStyle(el).backgroundColor.match(/\d+/g)!.map(Number));
  expect(green[1]!).toBeGreaterThan(green[0]!);
  expect(green[1]!).toBeGreaterThan(green[2]!);
  await card.locator('.ph-thumb').hover();
  await expect(page.getByTestId('ai-note')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/ai-marks-human.png' });
  // A right-click on the picture opens the menu too.
  await card.locator('.ph-thumb').click({ button: 'right' });
  await page.getByTestId('ai-mark-ai-generated').click();
  await expect(badge).toHaveAttribute('data-provenance', 'ai-generated');
  // Each said once, and going back to the rule takes the mark out of the file.
  expect(sent).toEqual([
    { key: 'model:barrel-prop', provenance: 'ai-assisted' },
    { key: 'model:barrel-prop', provenance: 'human-made' },
    { key: 'model:barrel-prop', provenance: null },
  ]);

  // The creatures in the Encounters strip, by the model each is drawn with.
  await page.getByTestId('mode-combat').click();
  await expect(page.getByTestId('combat-library').getByTestId('ai-badge').first()).toBeVisible();

  // The Cards page's preview: a card drawing its own emblem is the engine's art, not the book's.
  await page.locator('[data-testid="open-content"]').click();
  await page.locator('[data-testid="open-abilities"]').click();
  await page.locator('[data-testid="ability-panel"] [data-ability="rally-the-line"]').click();
  await expect(page.getByTestId('card-preview-frame').getByTestId('ai-badge')).toHaveAttribute('data-art', 'card:rally-the-line');

  // And the tests' own server keeps nothing, and the menu says so.
  await page.unroute('**/__art/provenance');
  await page.getByTestId('card-preview-frame').getByTestId('ai-badge').click();
  await page.getByTestId('ai-mark-human-made').click();
  await expect(page.getByTestId('ai-menu-said')).toContainText('Not kept');
});

test('the Models page marks each model in its preview', async ({ page }) => {
  await editing(page);
  await page.locator('[data-testid="open-content"]').click();
  await page.locator('[data-testid="open-models"]').click();
  const preview = page.locator('.ph-ai-frame', { has: page.getByTestId('asset-preview-quim') });
  await expect(preview.getByTestId('ai-badge')).toHaveAttribute('data-art', 'model:quim');
  await preview.hover();
  await expect(page.getByTestId('ai-note')).toHaveText('AI Generated');
  await page.screenshot({ path: 'test-results/ai-marks-models.png' });
});

test('in the game, AI art under the pointer - on the board or on a portrait - puts the note in the corner: red words, faded, in a serif hand, on nothing', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  const note = page.getByTestId('ai-note');
  // A member of the party, on the board: the pointer on their figure, a little above the ground they stand on.
  const where = await page.evaluate(() => {
    const api = window.__engine!;
    const id = api.party()[0]!;
    const spot = api.standingAt(id)!;
    return api.screenAt(spot.x, spot.y);
  });
  await expect.poll(async () => {
    await page.mouse.move(where.x + 1, where.y - 18);
    await page.mouse.move(where.x, where.y - 20);
    return note.count();
  }, { timeout: 10_000 }).toBe(1);
  await expect(note).toHaveText('AI Generated');
  const style = await note.evaluate((el) => {
    const css = getComputedStyle(el);
    return { font: css.fontFamily, opacity: Number(css.opacity), background: css.backgroundColor, colour: css.color };
  });
  // Red words, faded, in a serif hand - and nothing behind them.
  expect(style.font).toMatch(/serif/i);
  expect(style.opacity).toBeLessThan(1);
  expect(style.background).toBe('rgba(0, 0, 0, 0)');
  const [red, green, blue] = style.colour.match(/\d+/g)!.map(Number);
  expect(red!).toBeGreaterThan(180);
  expect(green!).toBeLessThan(90);
  expect(blue!).toBeLessThan(90);
  await page.screenshot({ path: 'test-results/ai-note-board.png' });
  // Off the board, and the note goes.
  await page.mouse.move(2, 2);
  await expect(note).toHaveCount(0);
  // A portrait in the party's cards says the same.
  await page.getByTestId('portrait').first().hover();
  await expect(note).toHaveText('AI Generated');
});

test('the editor puts up the same note, in the same hand', async ({ page }) => {
  await editing(page);
  await page.getByTestId('mode-terrain').click();
  const strip = page.getByTestId('terrain-library');
  await strip.locator('[data-tab="props"]').click();
  await strip.locator('.ph-card[data-item="barrel-prop"] .ph-thumb').hover();
  const note = page.getByTestId('ai-note');
  await expect(note).toHaveText('AI Generated');
  expect(await note.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/serif/i);
});

test('in the editor too, AI art under the pointer on the board puts up the note', async ({ page }) => {
  await editing(page);
  const note = page.getByTestId('ai-note');
  // A prop the room already has, on the board: the pointer on it, a little above the ground it stands on.
  const where = await page.evaluate(() => {
    const api = window.__engine!;
    const decos = (JSON.parse(api.exportProject()) as { scenes: { decos: { model: string; position: { x: number; y: number } }[] }[] }).scenes[0]!.decos;
    const barrel = decos.find((deco) => deco.model === 'barrel-prop') ?? decos[0]!;
    return { model: barrel.model, at: api.buildScreenAt(barrel.position.x, barrel.position.y) };
  });
  await expect.poll(async () => {
    for (const lift of [6, 12, 18, 24]) {
      await page.mouse.move(where.at.x, where.at.y - lift);
      await page.waitForTimeout(130);
      if ((await note.count()) === 1) return 1;
    }
    return 0;
  }, { timeout: 15_000 }).toBe(1);
  await expect(note).toHaveText('AI Generated');
  // Off the board, and it goes.
  await page.mouse.move(2, 400);
  await expect(note).toHaveCount(0);
});

