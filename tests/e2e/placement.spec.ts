import { expect, test } from '@playwright/test';

test('the right-side height ladder controls placement Z and follows the active tab', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.getByTestId('mode-terrain').click();
  // The ladder follows what is being placed rather than which tab is open - there is no
  // second terrain tab left for it to follow. A kind that stacks goes down at a height, so
  // it is what brings the ladder out; the placer opens holding flat ground, which does not.
  await page.evaluate(() => window.__engine!.setTerrain('block'));
  const height = page.getByTestId('placement-height');
  await expect(height).toBeVisible();
  const [controlBox, sideBox] = await Promise.all([
    height.boundingBox(),
    page.getByTestId('terrain-side').boundingBox(),
  ]);
  expect(controlBox).not.toBeNull();
  expect(sideBox).not.toBeNull();
  // Docked at the board's right edge: clear of the mode panel, but against it —
  // which fails if the ladder ever drifts back to the left of the board.
  expect(controlBox!.x + controlBox!.width).toBeLessThanOrEqual(sideBox!.x);
  expect(sideBox!.x - (controlBox!.x + controlBox!.width)).toBeLessThan(40);

  // A rung a whole tile up is drawn, and clicking it jumps to that level. Kept
  // close to the centre so a shorter viewport, which fits fewer rungs, cannot
  // clip the rung this test clicks.
  await page.getByRole('button', { name: 'Z 1', exact: true }).click();
  await expect(page.getByLabel('Build level', { exact: true })).toHaveValue('1');
  await page.evaluate(() => window.__engine!.buildAt(4, 4));
  const scene = JSON.parse(await page.evaluate(() => window.__engine!.exportProject())).scenes[0];
  expect(scene.buildingTiles['4,4,1']).toBeDefined();

  // The ladder re-centres on the new level, so its own rung is now the current one.
  await expect(page.getByTestId('height-ladder')).toHaveAttribute('aria-valuenow', '1');

  // Dragging scrubs, and the ladder moves with the pointer: pulling down brings
  // the levels above down to the selector, so the level climbs. Pixels are spent
  // against the shrinking rungs, so a short pull covers several quarter tiles.
  // This is the gesture the ladder exists for, and the only place the deferred
  // pointer capture and the guard on the click that trails a drag are exercised
  // together.
  const ladderBox = await page.getByTestId('height-ladder').boundingBox();
  expect(ladderBox).not.toBeNull();
  const midX = ladderBox!.x + ladderBox!.width / 2;
  const midY = ladderBox!.y + ladderBox!.height / 2;
  await page.mouse.move(midX, midY);
  await page.mouse.down();
  await page.mouse.move(midX, midY + 60, { steps: 6 });
  await page.mouse.up();
  const dragged = Number(await page.getByLabel('Build level', { exact: true }).inputValue());
  expect(dragged).toBeGreaterThan(1);

  // And it goes when what is in hand no longer needs it: flat ground is painted on the
  // floor it lies on, so there is no height to choose.
  await page.evaluate(() => window.__engine!.setTerrain('floor'));
  await expect(height).toHaveCount(0);
  await page.locator('[data-tab="props"]').click();
  await expect(page.getByTestId('placement-height')).toBeVisible();
  await page.screenshot({ path: 'test-results/right-height-ladder.png' });
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});

test('a selected creature is re-skinned by its type and on its own, and it survives a reload', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.getByTestId('mode-combat').click();

  const strip = page.getByTestId('combat-library');
  await strip.getByTestId('library-search').fill('hound');
  await strip.locator('[data-item]').first().click();

  // Editor chrome floats over the board, so take a tile whose surface is
  // actually clickable rather than naming one and hoping.
  const spot = await page.evaluate(() => {
    const api = window.__engine!;
    for (let y = 3; y <= 6; y += 1) {
      for (let x = 3; x <= 6; x += 1) {
        const at = api.buildScreenAt(x, y);
        if (document.elementFromPoint(at.x, at.y)?.id === 'gl') return { x, y, at };
      }
    }
    return null;
  });
  expect(spot).not.toBeNull();

  // Placing needs no panel, so the headless handle will do.
  await page.evaluate(({ x, y }) => window.__engine!.buildAt(x, y), spot!);
  await expect(page.getByTestId('selected-creature')).toHaveCount(0);

  // Selecting is a real click: that path is what re-renders the panel, and it is
  // what a designer actually does. `buildAt` applies the tool without drawing.
  await page.evaluate(() => window.__engine!.setTool('select'));
  await page.mouse.click(spot!.at.x, spot!.at.y);
  await expect(page.getByTestId('selected-creature')).toBeVisible();

  await page.getByTestId('type-model').selectOption('knight');
  await page.getByTestId('creature-model').selectOption('rogue');
  // The name commits on change, not on every keystroke — one rename is one undo
  // step — so the field has to lose focus before it takes.
  await page.getByTestId('creature-name').fill('Gorehide');
  await page.getByTestId('creature-name').blur();
  await page.screenshot({ path: 'test-results/creature-models.png' });

  const editing = await page.evaluate(() => window.__engine!.editScene());
  type Placed = { adversary: string; model?: string; name?: string; position: { x: number; y: number } };
  // The room comes with encounters of its own, so find the creature just placed
  // by where it stands rather than taking the first one in the list.
  const placedIn = (text: string): Placed => {
    const doc = JSON.parse(text);
    const scene = doc.scenes.find((s: { id: string }) => s.id === editing);
    const found = scene.encounters
      .flatMap((e: { adversaries: Placed[] }) => e.adversaries)
      .find((a: Placed) => a.position.x === spot!.x && a.position.y === spot!.y);
    expect(found).toBeDefined();
    return found as Placed;
  };

  const text = await page.evaluate(() => window.__engine!.exportProject());
  const placed = placedIn(text);
  // The type default and the one-creature override are stored apart, and the
  // creature's own override is what the panel put on the placement.
  expect(JSON.parse(text).adversaryModels[placed.adversary]).toBe('knight');
  expect(placed.model).toBe('rogue');
  expect(placed.name).toBe('Gorehide');

  // Clearing the override falls back to the type without disturbing it.
  await page.getByTestId('creature-model').selectOption('');
  const clearedText = await page.evaluate(() => window.__engine!.exportProject());
  expect(placedIn(clearedText).model).toBeUndefined();
  expect(JSON.parse(clearedText).adversaryModels[placed.adversary]).toBe('knight');

  expect(await page.evaluate((t) => window.__engine!.loadProjectText(t), text)).toBe('');
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});

test('open tabs drive placement; edge walls overlap floors and preserve Z through undo and load', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.getByTestId('mode-terrain').click();
  const strip = page.getByTestId('terrain-library');
  // The open tab puts the placement tool in hand, so none of them is on the rail.
  const placementTools = '[data-tool="prop"], [data-tool="interactable"], [data-tool="placeTile"]';
  await expect(page.locator(placementTools)).toHaveCount(0);
  // Strip cards are kinds of tile now, named by their terrain id: the `tile-<shape>` cards
  // went with the Structures tab they belonged to.
  await strip.locator('[data-item="platform"]').click();
  await page.evaluate(() => window.__engine!.buildAt(8, 6));
  await strip.locator('[data-item="barrier"]').click();
  for (const edge of ['North', 'East', 'South', 'West']) {
    await page.getByLabel(`Wall ${edge}`, { exact: true }).click();
    await page.evaluate(() => window.__engine!.buildAt(8, 6));
  }
  expect(await page.evaluate(() => window.__engine!.buildingStats().tiles)).toBe(5);
  await page.getByLabel('Build level', { exact: true }).fill('2.25');
  await page.getByLabel('Piece height', { exact: true }).fill('3.5');
  await page.getByLabel('Piece height', { exact: true }).press('Tab');
  await page.evaluate(() => window.__engine!.buildAt(8, 6));
  const saved = await page.evaluate(() => window.__engine!.exportProject());
  const scene = JSON.parse(saved).scenes[0];
  expect(scene.buildingTiles['8,6,2.25']).toMatchObject({ height: 3.5, level: 2.25, shape: 'wall' });
  await page.evaluate(() => window.__engine!.undo());
  expect(await page.evaluate(() => window.__engine!.buildingStats().tiles)).toBe(5);
  expect(await page.evaluate((s) => window.__engine!.loadProjectText(s), saved)).toBe('');
  await page.evaluate(() => {
    window.__engine!.setMode('edit');
    window.__engine!.setEditorMode('terrain');
  });
  await strip.locator('[data-tab="props"]').click();
  const before = await page.evaluate(() => window.__engine!.propCount());
  await page.evaluate(() => window.__engine!.buildAt(6, 6));
  expect(await page.evaluate(() => window.__engine!.propCount())).toBe(before + 1);
  await strip.locator('[data-tab="tiles"]').click();
  await expect(strip.locator('[data-tab="tiles"]')).toHaveClass(/ph-on/);
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});

test('creatures immediately appear in authored scenes, undo correctly, and enter play', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.getByTestId('mode-combat').click();
  const strip = page.getByTestId('combat-library');
  await strip.getByTestId('library-search').fill('hound');
  await strip.locator('[data-item]').click();
  const before = await page.evaluate(() => window.__engine!.authoredCreatureCount());
  const at = await page.evaluate(() => window.__engine!.buildScreenAt(8, 6));
  await page.mouse.click(at.x, at.y);
  expect(await page.evaluate(() => window.__engine!.authoredCreatureCount())).toBe(before + 1);
  const id = await page.evaluate(() => {
    const doc = JSON.parse(window.__engine!.exportProject());
    return doc.scenes[0].encounters.flatMap((e: { adversaries: { id: string; adversary: string }[] }) => e.adversaries)
      .find((a: { adversary: string }) => a.adversary === 'rot-hound').id as string;
  });
  await page.evaluate(() => window.__engine!.undo());
  expect(await page.evaluate(() => window.__engine!.authoredCreatureCount())).toBe(before);
  await page.evaluate(() => window.__engine!.redo());
  expect(await page.evaluate(() => window.__engine!.authoredCreatureCount())).toBe(before + 1);
  await page.screenshot({ path: 'test-results/creature-placement.png' });
  await page.evaluate(() => window.__engine!.setMode('play'));
  expect(await page.evaluate((id) => window.__engine!.tileOf(id), id)).toBe(6 * 22 + 8);
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.getByLabel('Creature Z').fill('3.25');
  await page.getByLabel('Creature Z').press('Tab');
  await page.evaluate(() => window.__engine!.buildAt(-200, 400));
  expect(await page.evaluate(() => window.__engine!.authoredCreatureCount())).toBe(before + 2);
  await page.evaluate(() => window.__engine!.addScene('Empty room'));
  expect(await page.evaluate(() => window.__engine!.authoredCreatureCount())).toBe(0);
  expect(errors).toEqual([]);
});

test('a creature clicked onto raised ground lands on the tile under the cursor', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.getByTestId('mode-combat').click();
  const strip = page.getByTestId('combat-library');
  await strip.getByTestId('library-search').fill('hound');
  await strip.locator('[data-item]').click();
  // The plateau in the north-east corner. A flat plane through the board's
  // base projects to a different tile from this camera angle than the raised
  // surface does, which is the whole point of the test. Which of its tiles can
  // be clicked depends on where the editor's chrome falls — the Z ladder is
  // docked over the board's right edge — so take the first raised one whose
  // surface projects onto the canvas rather than naming a tile that chrome may
  // later cover.
  const plateau = await page.evaluate(() => {
    const api = window.__engine!;
    for (let y = 2; y <= 5; y += 1) {
      for (let x = 19; x >= 15; x -= 1) {
        const tile = y * 22 + x;
        if (api.heightAt(tile) <= 0) continue;
        const point = api.screenOf(tile);
        if (document.elementFromPoint(point.x, point.y)?.id === 'gl') return tile;
      }
    }
    return -1;
  });
  expect(plateau).toBeGreaterThan(0);
  expect(await page.evaluate((tile) => window.__engine!.heightAt(tile), plateau)).toBeGreaterThan(0);
  const placements = async (): Promise<{ id: string; position: { x: number; y: number } }[]> =>
    page.evaluate(() => (JSON.parse(window.__engine!.exportProject()) as {
      scenes: { encounters: { adversaries: { id: string; position: { x: number; y: number } }[] }[] }[];
    }).scenes[0]!.encounters.flatMap((e) => e.adversaries));
  const before = new Set((await placements()).map((a) => a.id));
  // `screenOf` projects the tile's real surface, not the build plane, so the
  // click lands where a designer aiming at the plateau would put it.
  const at = await page.evaluate((tile) => window.__engine!.screenOf(tile), plateau);
  await page.mouse.click(at.x, at.y);
  const added = (await placements()).filter((a) => !before.has(a.id));
  expect(added).toHaveLength(1);
  expect(added[0]!.position).toMatchObject({ x: plateau % 22, y: Math.floor(plateau / 22) });
  expect(errors).toEqual([]);
});
