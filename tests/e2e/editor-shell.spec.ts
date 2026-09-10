import { test, expect, type Page } from '@playwright/test';

/**
 * The editor's shell, clicked: the top bar and its menus, the four modes and
 * their keys, each mode's tools and library, workspaces under the bar, and the
 * purple the user asked for.
 */

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

const mode = (page: Page): Promise<string> => page.evaluate(() => window.__polyheart!.editorMode());

test('the top bar holds the four modes in the order the user set, and 1-4 switch them', async ({ page }) => {
  const errors = await editing(page);
  await expect(page.locator('[data-testid="top-bar"]')).toBeVisible();
  await expect(page.locator('[data-testid^="mode-"]')).toHaveText([/Inspector/, /Terrain/, /Combat/, /Interaction/]);
  // The editor opens on the first of them.
  expect(await mode(page)).toBe('inspect');

  for (const [key, expected] of [
    ['2', 'terrain'],
    ['3', 'combat'],
    ['4', 'interaction'],
    ['1', 'inspect'],
  ] as const) {
    await page.keyboard.press(key);
    expect(await mode(page)).toBe(expected);
    await expect(page.locator(`[data-testid="mode-${expected}"]`)).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: `test-results/shell-${expected}.png` });
  }
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the editor is purple', async ({ page }) => {
  const errors = await editing(page);
  const active = page.locator('[data-testid="mode-inspect"]');
  expect(await active.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(181, 140, 255)');
  expect(await page.locator('[data-testid="play"]').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    'rgb(181, 140, 255)',
  );
  // Inspector is active, so Terrain's mode tab is inactive and should be muted, not white.
  const inactiveMode = page.locator('[data-testid="mode-terrain"]');
  expect(await inactiveMode.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(165, 156, 186)');

  await page.locator('[data-testid="mode-terrain"]').click();
  const strip = page.locator('[data-testid="terrain-library"]');
  const [open, closed] = await Promise.all([
    strip.locator('[data-tab="ground"]').evaluate((el) => getComputedStyle(el).backgroundColor),
    strip.locator('[data-tab="props"]').evaluate((el) => getComputedStyle(el).backgroundColor),
  ]);
  expect(open).not.toBe(closed);

  expect(errors).toEqual([]);
});

test('Terrain: its own tools, and a pick from the strip takes up the tool that places it', async ({ page }) => {
  const errors = await editing(page);
  await page.locator('[data-testid="mode-terrain"]').click();
  await expect(page.locator('[data-testid="tool-rail"] [data-tool]')).toHaveCount(6);

  const strip = page.locator('[data-testid="terrain-library"]');
  await strip.locator('[data-tab="props"]').click();
  await strip.locator('[data-item="barrel"]').click();
  await expect(page.locator('[data-testid="tool-rail"] [data-tool="prop"]')).toHaveAttribute('aria-pressed', 'true');

  const placed = await page.evaluate(() => {
    const api = window.__polyheart!;
    const models = (): string[] =>
      (JSON.parse(api.exportProject()) as { scenes: { decos: { model: string }[] }[] }).scenes[0]!.decos.map((d) => d.model);
    const barrels = (): number => models().filter((model) => model === 'barrel').length;
    const before = { all: models().length, barrels: barrels() };
    api.editAt(2 * 22 + 2);
    return { added: models().length - before.all, barrels: barrels() - before.barrels };
  });
  // One deco more, and it is the barrel the strip picked - not merely a change of tool.
  expect(placed).toEqual({ added: 1, barrels: 1 });
  expect(errors).toEqual([]);
});

test('Combat: its own tools, and a creature found by searching is the one placed', async ({ page }) => {
  const errors = await editing(page);
  await page.locator('[data-testid="mode-combat"]').click();
  await expect(page.locator('[data-testid="tool-rail"] [data-tool]')).toHaveCount(4);

  // Search for a creature that is not the default `tangle-bramble`, and read
  // its id from the card rather than guessing it, so the test still means
  // something if the SRD list ever renumbers.
  const strip = page.locator('[data-testid="combat-library"]');
  await strip.locator('[data-testid="library-search"]').fill('wolf');
  const found = strip.locator('[data-item]');
  await expect(found).toHaveCount(1);
  const creatureId = await found.getAttribute('data-item');
  expect(creatureId).not.toBe('tangle-bramble');
  await found.click();

  const placed = await page.evaluate((id) => {
    const api = window.__polyheart!;
    const kinds = (): string[] =>
      (JSON.parse(api.exportProject()) as { scenes: { encounters: { adversaries: { adversary: string }[] }[] }[] }).scenes[0]!
        .encounters.flatMap((e) => e.adversaries.map((a) => a.adversary));
    const matching = (): number => kinds().filter((kind) => kind === id).length;
    const before = { all: kinds().length, matching: matching() };
    api.editAt(2 * 22 + 2);
    return { added: kinds().length - before.all, matching: matching() - before.matching };
  }, creatureId);
  // One creature more, and it is the one the search found - wherever the encounter lists it.
  expect(placed).toEqual({ added: 1, matching: 1 });

  // First browser coverage of a rail click: it changes the tool in hand.
  await page.locator('[data-testid="tool-rail"] [data-tool="trigger"]').click();
  await expect(page.locator('[data-testid="tool-rail"] [data-tool="trigger"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid="tool-rail"] [data-tool="adversary"]')).toHaveAttribute('aria-pressed', 'false');

  expect(errors).toEqual([]);
});

test('Content opens a workspace under the top bar, and Esc closes it', async ({ page }) => {
  const errors = await editing(page);
  await page.locator('[data-testid="open-content"]').click();
  await page.locator('[data-testid="open-quests"]').click();
  await expect(page.locator('[data-testid="quests-panel"]')).toBeVisible();
  // The way back is still on screen.
  await expect(page.locator('[data-testid="mode-inspect"]')).toBeVisible();
  await page.screenshot({ path: 'test-results/shell-workspace.png' });

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="quests-panel"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Interaction lists the conversations and opens one as a graph', async ({ page }) => {
  const errors = await editing(page);
  await expect(page.locator('[data-testid="top-bar"]')).toBeVisible();
  await page.keyboard.press('4');
  await expect(page.locator('[data-testid="interaction-side"]')).toBeVisible();
  await page.locator('[data-testid="interaction-side"]').getByRole('button', { name: /the-listening-pillar/ }).click();
  await expect(page.locator('[data-testid="dialogue-graph"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('undoing a new conversation returns to the conversation list', async ({ page }) => {
  const errors = await editing(page);
  await page.locator('[data-testid="mode-interaction"]').click();
  page.once('dialog', (d) => d.accept('a-new-talk'));
  await page.locator('[data-testid="add-conversation"]').click();
  await expect(page.locator('[data-testid="dialogue-graph"]')).toBeVisible();

  await page.locator('[data-testid="undo"]').click();
  await expect(page.locator('[data-testid="interaction-side"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Project: Check lists what it found', async ({ page }) => {
  const errors = await editing(page);
  await page.locator('[data-testid="open-project"]').click();
  await page.locator('[data-testid="check-project"]').click();
  await expect(page.locator('[data-testid="problems"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the scene picker switches the room being edited, and the top bar undoes', async ({ page }) => {
  const errors = await editing(page);
  await page.locator('[data-testid="open-scenes"]').click();
  await page.locator('[data-testid="scene-menu"] [data-scene="the-pit"]').click();
  expect(await page.evaluate(() => window.__polyheart!.editScene())).toBe('the-pit');

  const painted = await page.evaluate(() => {
    const api = window.__polyheart!;
    api.setTool('paintTerrain');
    api.setTerrain('wall');
    // Find the first pit tile that is not 'wall'
    let tile = 0;
    const sceneTiles = api.sceneTiles();
    while (tile < sceneTiles && api.terrainAt(tile) === 'wall') {
      tile++;
    }
    const before = api.terrainAt(tile);
    api.editAt(tile);
    return { tile, before, after: api.terrainAt(tile) };
  });
  expect(painted.after).toBe('wall');
  await page.locator('[data-testid="undo"]').click();
  expect(await page.evaluate((tile) => window.__polyheart!.terrainAt(tile), painted.tile)).toBe(painted.before);
  expect(errors).toEqual([]);
});
