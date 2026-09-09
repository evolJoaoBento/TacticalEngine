import { test, expect, type Page } from '@playwright/test';

/**
 * The editor's authoring panels, clicked.
 *
 * The map tools are driven by `demo.spec.ts` through the handles. The panels a
 * designer actually lives in - party, items, abilities, code, quests, assets -
 * had never been opened by a spec at all, and they are the largest surface in
 * the app with no browser coverage.
 */

const PANELS = [
  { open: 'open-party', panel: 'party-panel', add: 'add-character', close: 'close-party' },
  { open: 'open-items', panel: 'item-panel', add: 'add-item', close: 'close-items' },
  { open: 'open-abilities', panel: 'ability-panel', add: 'add-ability', close: 'close-abilities' },
  { open: 'open-code', panel: 'code-panel', add: 'add-code', close: 'close-code' },
] as const;

async function editing(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__polyheart !== undefined && window.__polyheart.frames > 2, null, {
    timeout: 30_000,
  });
  await page.evaluate(() => {
    window.__polyheart!.setDiceSpeed(0);
    window.__polyheart!.setMode('edit');
  });
  return errors;
}

test('every authoring panel opens and reads as English', async ({ page }) => {
  const errors = await editing(page);
  expect(await page.evaluate(() => window.__polyheart!.mode())).toBe('edit');

  for (const { open, panel, close } of PANELS) {
    const button = page.locator(`[data-testid="${open}"]`);
    await expect(button, `${open} is on screen`).toBeVisible();
    await button.click();
    const body = page.locator(`[data-testid="${panel}"]`);
    await expect(body, `${panel} opened`).toBeVisible();
    const text = await body.innerText();
    console.log(`${panel}:`, JSON.stringify(text.slice(0, 220)));
    expect(text.length, `${panel} has something in it`).toBeGreaterThan(0);
    await page.screenshot({ path: `test-results/editor-${panel}.png` });
    // Each panel has its own Close: the button that opened it does not toggle.
    await page.locator(`[data-testid="${close}"]`).click();
  }

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a designer can add one of each thing, and the panel shows it', async ({ page }) => {
  const errors = await editing(page);

  // Every Add asks for a name with `window.prompt`, and Playwright dismisses a
  // dialog nobody is listening for - which reads exactly like a dead button.
  // Answering it is what makes this a test of the panel rather than of the
  // browser default.
  page.on('dialog', (d) => void d.accept('Newcomer'));

  // What the panel itself says, before and after - which is what a designer
  // has to go on.  is a different question: the demo's party
  // lives in sheets rather than in , so counting that
  // array would be counting the wrong thing.
  const grew: string[] = [];
  for (const { open, panel, add, close } of PANELS) {
    await page.locator(`[data-testid="${open}"]`).click();
    const body = page.locator(`[data-testid="${panel}"]`);
    await expect(body).toBeVisible();
    const before = await body.innerText();

    const button = page.locator(`[data-testid="${add}"]`);
    expect(await button.count(), `${add} is offered`).toBeGreaterThan(0);
    await button.first().click();
    // The panel redraws on its own tick, so read after it has had one.
    await page.waitForTimeout(150);
    const after = await body.innerText();
    if (after !== before) grew.push(panel);
    console.log(`${panel}:`, before.length, '->', after.length);

    await page.locator(`[data-testid="${close}"]`).click();
  }
  console.log('GREW:', JSON.stringify(grew));
  expect(grew, 'every Add button adds something the panel shows').toEqual(PANELS.map((p) => p.panel));

  // And what it wrote is a project the game takes back.
  const reloaded = await page.evaluate(() => {
    const a = window.__polyheart!;
    return a.loadProjectText(a.exportProject());
  });
  console.log('RELOADED:', JSON.stringify(reloaded));
  expect(reloaded.toLowerCase(), 'the project it wrote loads again').not.toContain('error');

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a scene added in the editor is in the project and can be switched to', async ({ page }) => {
  const errors = await editing(page);

  const made = await page.evaluate(() => {
    const a = window.__polyheart!;
    const before = a.scenes().length;
    const id = a.addScene('A cellar');
    a.switchScene(id);
    return { before, id, after: a.scenes().length, editing: a.editScene(), tiles: a.sceneTiles() };
  });
  console.log('SCENE:', JSON.stringify(made));

  expect(made.after).toBe(made.before + 1);
  expect(made.editing).toBe(made.id);
  expect(made.tiles, 'the new room has ground to paint').toBeGreaterThan(0);

  // Paint a tile in it, and the paint sticks.
  const painted = await page.evaluate(() => {
    const a = window.__polyheart!;
    a.setMode('edit');
    a.setTool('paintTerrain');
    a.setTerrain('water');
    const ok = a.editAt(0);
    return { ok, at: a.terrainAt(0), undone: a.undo(), afterUndo: a.terrainAt(0) };
  });
  console.log('PAINTED:', JSON.stringify(painted));
  expect(painted.ok).toBe(true);
  expect(painted.at).toBe('water');
  // Undo puts it back, which is what makes a map tool safe to try.
  expect(painted.undone).toBe(true);
  expect(painted.afterUndo).not.toBe('water');

  await page.screenshot({ path: 'test-results/editor-scene.png' });
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a character added in the Party panel is standing with the party when Play is pressed', async ({ page }) => {
  const errors = await editing(page);
  page.on('dialog', (d) => void d.accept('Tamsin'));

  const before = await page.evaluate(() => window.__polyheart!.party());

  await page.locator('[data-testid="open-party"]').click();
  await expect(page.locator('[data-testid="party-panel"]')).toBeVisible();
  await page.locator('[data-testid="add-character"]').first().click();
  await page.waitForTimeout(150);
  await page.locator('[data-testid="close-party"]').click();

  // Nothing on the board yet: the panel wrote a sheet, and that is all it does.
  expect(await page.evaluate(() => window.__polyheart!.party())).toEqual(before);

  const played = await page.evaluate(() => {
    const a = window.__polyheart!;
    a.setMode('play');
    const party = a.party();
    const anchor = a.selected() ?? party[0]!;
    return {
      party,
      tile: a.tileOf('tamsin'),
      anchorTile: a.tileOf(anchor),
      log: a.log().slice(-3).map((l) => l.text),
    };
  });
  console.log('PLAYED:', JSON.stringify(played));

  expect(played.party, 'the newcomer is in the party').toEqual([...before, 'tamsin']);
  expect(played.tile, 'and standing on the board').not.toBe(-1);
  const away = Math.max(
    Math.abs((played.tile % 22) - (played.anchorTile % 22)),
    Math.abs(Math.floor(played.tile / 22) - Math.floor(played.anchorTile / 22)),
  );
  expect(away, 'beside whoever was selected').toBeLessThanOrEqual(1);
  expect(played.log.join(' | '), 'the log says so').toContain('Tamsin joins the party.');

  await page.screenshot({ path: 'test-results/editor-joined.png' });
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});
