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
  await page.waitForFunction(() => window.__engine !== undefined && window.__engine.frames > 2, null, {
    timeout: 30_000,
  });
  await page.evaluate(() => {
    window.__engine!.setDiceSpeed(0);
    window.__engine!.setMode('edit');
  });
  return errors;
}

const mode = (page: Page): Promise<string> => page.evaluate(() => window.__engine!.editorMode());

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

test('the frame rate reads under the top bar, and counts frames rather than guessing', async ({ page }) => {
  const errors = await editing(page);
  const fps = page.locator('[data-testid="frame-rate"]');
  await expect(fps).toBeVisible();
  // A number, once it has two frames to compare - not the em dash it starts at.
  await expect.poll(async () => (await fps.innerText()).trim(), { timeout: 10_000 }).toMatch(/^\d+ fps$/);

  // Centred under the bar, which is the 40px the rail, the panels and the strip all start
  // at. Asserted rather than eyeballed because a readout that drifts over the modes or the
  // board is worse than none.
  const [box, bar] = await Promise.all([fps.boundingBox(), page.locator('[data-testid="top-bar"]').boundingBox()]);
  expect(box).not.toBeNull();
  expect(bar).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height - 1);
  const drift = Math.abs(box!.x + box!.width / 2 - (bar!.x + bar!.width / 2));
  expect(drift).toBeLessThan(2);

  // It takes no pointer events, so the board underneath stays clickable through the middle
  // of the screen - the whole reason it is not a panel.
  const middle = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="frame-rate"]') as HTMLElement;
    const r = el.getBoundingClientRect();
    return (document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) as HTMLElement).dataset.testid ?? '';
  });
  expect(middle).not.toBe('frame-rate');
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('an object can be drawn with any model the project has, and put back to its kind', async ({ page }) => {
  const errors = await editing(page);
  await page.evaluate(() => {
    const api = window.__engine!;
    api.selectObject(api.objects().find((id) => id.startsWith('chest'))!);
  });

  // Null until something is picked: the kind's own body is what `scene-view` falls back to,
  // and the schema spells "no model of its own" as null rather than as an empty string.
  expect(await page.evaluate(() => window.__engine!.objectField('model'))).toBeNull();

  const picker = page.locator('[data-testid="object-model"]');
  await expect(picker).toBeVisible();
  // Every shipped .glb is in `project.assets`, discovered from public/models at build time,
  // so the same list that re-skins a creature re-skins a chest.
  await expect(picker.locator('option[value="stone-block"]')).toHaveCount(1);
  await picker.selectOption('stone-block');
  expect(await page.evaluate(() => window.__engine!.objectField('model'))).toBe('stone-block');

  // It goes through `updateInteractable` like every other field in this panel, so the top
  // bar's undo reaches it rather than the document being written behind the session's back.
  await page.locator('[data-testid="undo"]').click();
  expect(await page.evaluate(() => window.__engine!.objectField('model'))).toBeNull();
  await page.locator('[data-testid="redo"]').click();
  expect(await page.evaluate(() => window.__engine!.objectField('model'))).toBe('stone-block');

  // And back to the kind's own body: the empty option must write null, not ''. Asserted on
  // the value rather than with a second undo, because successive edits to the same field
  // share a merge key and coalesce into one step (`session.ts:481`, pinned by
  // `session.test.ts:722`) - so an undo here rewinds the whole model change, not this half.
  await picker.selectOption('');
  expect(await page.evaluate(() => window.__engine!.objectField('model'))).toBeNull();
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the editor is Blender-grey: white on the selected tab, blue only on the one primary button', async ({ page }) => {
  const errors = await editing(page);
  const active = page.locator('[data-testid="mode-inspect"]');
  expect(await active.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(230, 230, 230)');
  expect(await page.locator('[data-testid="play"]').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    'rgb(71, 114, 179)',
  );
  // Inspector is active, so Terrain's mode tab is inactive and should be muted, not white.
  const inactiveMode = page.locator('[data-testid="mode-terrain"]');
  expect(await inactiveMode.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(160, 160, 160)');

  await page.locator('[data-testid="mode-terrain"]').click();
  const strip = page.locator('[data-testid="terrain-library"]');
  const [open, closed] = await Promise.all([
    strip.locator('[data-tab="tiles"]').evaluate((el) => getComputedStyle(el).backgroundColor),
    strip.locator('[data-tab="props"]').evaluate((el) => getComputedStyle(el).backgroundColor),
  ]);
  expect(open).not.toBe(closed);

  expect(errors).toEqual([]);
});

test('Terrain: its own tools, and a pick from the strip takes up the tool that places it', async ({ page }) => {
  const errors = await editing(page);
  await page.locator('[data-testid="mode-terrain"]').click();
  // Four. Tiles and Structures were two tabs and are one, so Raise and Lower came across
  // with the ground they move: Erase, Raise, Lower beside the placer - and Select, which is
  // on every tab's rail because laying a room out means nudging what is already in it.
  await expect(page.locator('[data-testid="tool-rail"] [data-tool]')).toHaveCount(4);
  await expect(page.locator('[data-testid="tool-rail"] [data-tool="select"]')).toHaveCount(1);

  const strip = page.locator('[data-testid="terrain-library"]');
  await strip.locator('[data-tab="props"]').click();
  await strip.locator('[data-item="barrel"]').click();
  await expect(strip.locator('[data-tab="props"]')).toHaveClass(/ph-on/);
  await expect(page.locator('[data-testid="tool-rail"] [data-tool="prop"]')).toHaveCount(0);
  // The rail not showing it is only half the claim: the pick has to have put
  // the prop tool in hand, which the rail's absent button cannot say.
  expect(await page.evaluate(() => window.__engine!.editorTool())).toBe('prop');
  expect(await page.evaluate(() => window.__engine!.editorTerrainTab())).toBe('props');
  // Erase belongs to the Props tab too, so picking it keeps the strip where it
  // is and the rail keeps showing the tool in hand.
  await page.locator('[data-testid="tool-rail"] [data-tool="erase"]').click();
  expect(await page.evaluate(() => window.__engine!.editorTool())).toBe('erase');
  expect(await page.evaluate(() => window.__engine!.editorTerrainTab())).toBe('props');
  await expect(page.locator('[data-testid="tool-rail"] [data-tool="erase"]')).toHaveCount(1);
  await strip.locator('[data-item="barrel"]').click();

  const placed = await page.evaluate(() => {
    const api = window.__engine!;
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
  const combatTools = page.locator('[data-testid="tool-rail"] [data-tool]');
  await expect(combatTools).toHaveCount(5);
  // Named and in order rather than merely counted: Select has to come last, or
  // entering Combat would hand over selection instead of creature placement.
  expect(await combatTools.evaluateAll((els) => els.map((el) => el.getAttribute('data-tool')))).toEqual([
    'adversary',
    'trigger',
    'spawn',
    'erase',
    'select',
  ]);

  // Search for a creature that is not the tool's default, and read its id from
  // the card rather than guessing it, so the test still means something if the
  // pack ever grows or reorders. 'hound' matches Rot Hound alone; 'bandit'
  // would match three.
  const strip = page.locator('[data-testid="combat-library"]');
  await strip.locator('[data-testid="library-search"]').fill('hound');
  const found = strip.locator('[data-item]');
  await expect(found).toHaveCount(1);
  const creatureId = await found.getAttribute('data-item');
  expect(creatureId).not.toBe('bandit-cutter');
  await found.click();

  const placed = await page.evaluate((id) => {
    const api = window.__engine!;
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
  expect(await page.evaluate(() => window.__engine!.editScene())).toBe('the-pit');

  // An edit is a piece stamped on a cell, not a kind written into the ground, so what says
  // it landed is the scene's `buildingTiles` rather than `terrainAt` - which reads the
  // ground underneath and is the same before and after by design.
  const pieces = (): Promise<string[]> =>
    page.evaluate(() => {
      const doc = JSON.parse(window.__engine!.exportProject()) as {
        scenes: { id: string; buildingTiles?: Record<string, unknown> }[];
      };
      return Object.keys(doc.scenes.find((scene) => scene.id === 'the-pit')?.buildingTiles ?? {});
    });

  const before = await pieces();
  expect(before).not.toContain('0,0,0');
  const landed = await page.evaluate(() => {
    const api = window.__engine!;
    api.setTool('placeTile');
    api.setTerrain('block');
    return api.editAt(0);
  });
  expect(landed).toBe(true);
  expect(await pieces()).toContain('0,0,0');

  // The top bar's undo reaches the scene being edited, which is the point of this test.
  await page.locator('[data-testid="undo"]').click();
  expect(await pieces()).toEqual(before);
  expect(errors).toEqual([]);
});
