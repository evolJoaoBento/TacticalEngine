import { expect, test } from '@playwright/test';

test('the left-side height slider controls placement Z and follows the active tab', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window.__polyheart?.frames ?? 0) > 5);
  await page.evaluate(() => window.__polyheart!.setMode('edit'));
  await page.getByTestId('mode-terrain').click();
  const height = page.getByTestId('placement-height');
  await expect(height).toBeVisible();
  const [controlBox, sideBox] = await Promise.all([
    height.boundingBox(),
    page.getByTestId('terrain-side').boundingBox(),
  ]);
  expect(controlBox).not.toBeNull();
  expect(sideBox).not.toBeNull();
  expect(controlBox!.x + controlBox!.width).toBeLessThan(sideBox!.x);

  await page.getByLabel('Placement height slider').fill('2.25');
  await expect(page.getByLabel('Build level', { exact: true })).toHaveValue('2.25');
  await page.evaluate(() => window.__polyheart!.buildAt(4, 4));
  const scene = JSON.parse(await page.evaluate(() => window.__polyheart!.exportProject())).scenes[0];
  expect(scene.buildingTiles['4,4,2.25']).toBeDefined();

  await page.locator('[data-tab="ground"]').click();
  await expect(height).toHaveCount(0);
  await page.locator('[data-tab="props"]').click();
  await expect(page.getByTestId('placement-height')).toBeVisible();
  await page.screenshot({ path: 'test-results/left-height-slider.png' });
  expect(await page.evaluate(() => window.__polyheart!.errors)).toEqual([]);
});

test('open tabs drive placement; edge walls overlap floors and preserve Z through undo and load', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window.__polyheart?.frames ?? 0) > 5);
  await page.evaluate(() => window.__polyheart!.setMode('edit'));
  await page.getByTestId('mode-terrain').click();
  const strip = page.getByTestId('terrain-library');
  // The open tab puts the placement tool in hand, so none of them is on the rail.
  const placementTools = '[data-tool="buildTile"], [data-tool="prop"], [data-tool="interactable"], [data-tool="paintTerrain"]';
  await expect(page.locator(placementTools)).toHaveCount(0);
  await strip.locator('[data-item="tile-floor"]').click();
  await page.evaluate(() => window.__polyheart!.buildAt(8, 6));
  await strip.locator('[data-item="tile-wall"]').click();
  for (const edge of ['North', 'East', 'South', 'West']) {
    await page.getByLabel(`Wall ${edge}`, { exact: true }).click();
    await page.evaluate(() => window.__polyheart!.buildAt(8, 6));
  }
  expect(await page.evaluate(() => window.__polyheart!.buildingStats().tiles)).toBe(5);
  await page.getByLabel('Build level', { exact: true }).fill('2.25');
  await page.getByLabel('Piece height', { exact: true }).fill('3.5');
  await page.getByLabel('Piece height', { exact: true }).press('Tab');
  await page.evaluate(() => window.__polyheart!.buildAt(8, 6));
  const saved = await page.evaluate(() => window.__polyheart!.exportProject());
  const scene = JSON.parse(saved).scenes[0];
  expect(scene.buildingTiles['8,6,2.25']).toMatchObject({ height: 3.5, level: 2.25, shape: 'wall' });
  await page.evaluate(() => window.__polyheart!.undo());
  expect(await page.evaluate(() => window.__polyheart!.buildingStats().tiles)).toBe(5);
  expect(await page.evaluate((s) => window.__polyheart!.loadProjectText(s), saved)).toBe('');
  await page.evaluate(() => {
    window.__polyheart!.setMode('edit');
    window.__polyheart!.setEditorMode('terrain');
  });
  await strip.locator('[data-tab="props"]').click();
  const before = await page.evaluate(() => window.__polyheart!.propCount());
  await page.evaluate(() => window.__polyheart!.buildAt(6, 6));
  expect(await page.evaluate(() => window.__polyheart!.propCount())).toBe(before + 1);
  await strip.locator('[data-tab="tiles"]').click();
  await expect(strip.locator('[data-tab="tiles"]')).toHaveClass(/ph-on/);
  expect(await page.evaluate(() => window.__polyheart!.errors)).toEqual([]);
});

test('creatures immediately appear in authored scenes, undo correctly, and enter play', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => (window.__polyheart?.frames ?? 0) > 5);
  await page.evaluate(() => window.__polyheart!.setMode('edit'));
  await page.getByTestId('mode-combat').click();
  const strip = page.getByTestId('combat-library');
  await strip.getByTestId('library-search').fill('wolf');
  await strip.locator('[data-item]').click();
  const before = await page.evaluate(() => window.__polyheart!.authoredCreatureCount());
  const at = await page.evaluate(() => window.__polyheart!.buildScreenAt(8, 6));
  await page.mouse.click(at.x, at.y);
  expect(await page.evaluate(() => window.__polyheart!.authoredCreatureCount())).toBe(before + 1);
  const id = await page.evaluate(() => {
    const doc = JSON.parse(window.__polyheart!.exportProject());
    return doc.scenes[0].encounters.flatMap((e: { adversaries: { id: string; adversary: string }[] }) => e.adversaries)
      .find((a: { adversary: string }) => a.adversary === 'dire-wolf').id as string;
  });
  await page.evaluate(() => window.__polyheart!.undo());
  expect(await page.evaluate(() => window.__polyheart!.authoredCreatureCount())).toBe(before);
  await page.evaluate(() => window.__polyheart!.redo());
  expect(await page.evaluate(() => window.__polyheart!.authoredCreatureCount())).toBe(before + 1);
  await page.screenshot({ path: 'test-results/creature-placement.png' });
  await page.evaluate(() => window.__polyheart!.setMode('play'));
  expect(await page.evaluate((id) => window.__polyheart!.tileOf(id), id)).toBe(6 * 22 + 8);
  await page.evaluate(() => window.__polyheart!.setMode('edit'));
  await page.getByLabel('Creature Z').fill('3.25');
  await page.getByLabel('Creature Z').press('Tab');
  await page.evaluate(() => window.__polyheart!.buildAt(-200, 400));
  expect(await page.evaluate(() => window.__polyheart!.authoredCreatureCount())).toBe(before + 2);
  await page.evaluate(() => window.__polyheart!.addScene('Empty room'));
  expect(await page.evaluate(() => window.__polyheart!.authoredCreatureCount())).toBe(0);
  expect(errors).toEqual([]);
});

test('a creature clicked onto raised ground lands on the tile under the cursor', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => (window.__polyheart?.frames ?? 0) > 5);
  await page.evaluate(() => window.__polyheart!.setMode('edit'));
  await page.getByTestId('mode-combat').click();
  const strip = page.getByTestId('combat-library');
  await strip.getByTestId('library-search').fill('wolf');
  await strip.locator('[data-item]').click();
  // The plateau in the north-east corner. A flat plane through the board's
  // base projects to a different tile from this camera angle than the raised
  // surface does, which is the whole point of the test.
  const plateau = 3 * 22 + 18;
  expect(await page.evaluate((tile) => window.__polyheart!.heightAt(tile), plateau)).toBeGreaterThan(0);
  const placements = async (): Promise<{ id: string; position: { x: number; y: number } }[]> =>
    page.evaluate(() => (JSON.parse(window.__polyheart!.exportProject()) as {
      scenes: { encounters: { adversaries: { id: string; position: { x: number; y: number } }[] }[] }[];
    }).scenes[0]!.encounters.flatMap((e) => e.adversaries));
  const before = new Set((await placements()).map((a) => a.id));
  // `screenOf` projects the tile's real surface, not the build plane, so the
  // click lands where a designer aiming at the plateau would put it.
  const at = await page.evaluate((tile) => window.__polyheart!.screenOf(tile), plateau);
  const onCanvas = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id ?? '', at);
  expect(onCanvas).toBe('gl');
  await page.mouse.click(at.x, at.y);
  const added = (await placements()).filter((a) => !before.has(a.id));
  expect(added).toHaveLength(1);
  expect(added[0]!.position).toMatchObject({ x: 18, y: 3 });
  expect(errors).toEqual([]);
});
