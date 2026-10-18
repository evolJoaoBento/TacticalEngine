import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
import type { ConsoleMessage } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * A material imported (`docs/MANUAL.md`, "Surfaces"): the test's own set of bricks, zipped as an ambientCG download is
 * (`tools/make-tile-surface-fixture.mjs`), given to + Surface in the Tiles workspace. Four kinds of tile come of it - a
 * block, a wall, a floor slab and a staircase - in the Terrain strip; one undo takes them all away and a redo brings
 * them back; each is stamped on the board and drawn in the material, with no shader failing to compile. Its maps are
 * compressed for the GPU at import - KTX2 - and the GPU holds them compressed, WebGL saying nothing amiss. The test
 * never saves: `projects/default.json` is tracked.
 */

const ZIP = resolve('tests/fixtures/tile-surface/TestStone_1K-PNG.zip');

/**
 * A shader that failed, or a GL call refused - never a compiler's warning, which three logs as a warning (its "Program
 * Info Log") for a shader that works: Direct3D's compiler gives one for the environment map's, whenever the machine's
 * shader cache has not seen it.
 */
const glFailure = (message: ConsoleMessage): boolean => /GL_INVALID|WebGL: INVALID/.test(message.text()) || (message.type() === 'error' && /Shader Error|WebGLProgram/.test(message.text()));
const KINDS = ['block', 'wall', 'floor', 'stairs'] as const;

test('a material imported gives four tiles, undone and redone as one, each stamped and drawn in it', async ({ page }) => {
  test.setTimeout(120_000);
  const failed: string[] = [];
  page.on('console', (message) => {
    if (glFailure(message)) failed.push(message.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.getByTestId('mode-terrain').click();

  await page.getByTestId('open-content').click();
  await page.getByTestId('open-tiles').click();
  await page.getByTestId('surface-file').setInputFiles(ZIP);
  await expect(page.getByTestId('surface-status')).toHaveText('Imported Test Stone: four tiles in the Terrain strip. Not read: TestStone_1K-PNG.usdc.', { timeout: 30_000 });
  await expect(page.getByTestId('surface-editor')).toBeVisible();
  await expect(page.locator('[data-surface="test-stone"]')).toBeVisible();
  await page.screenshot({ path: 'test-results/tile-surfaces-workspace.png' });
  await page.getByTestId('close-tiles').click();

  const card = (kind: string) => page.locator(`[data-testid=terrain-library] [data-item="test-stone-${kind}"]`);
  for (const kind of KINDS) await expect(card(kind)).toBeVisible();
  // The import is one step: undone, the four go; redone, they are back.
  expect(await page.evaluate(() => window.__engine!.undo())).toBe(true);
  for (const kind of KINDS) await expect(card(kind)).toHaveCount(0);
  expect(await page.evaluate(() => window.__engine!.redo())).toBe(true);
  for (const kind of KINDS) await expect(card(kind)).toBeVisible();

  // Each stamped, side by side, the camera brought to them.
  const before = await page.evaluate(() => window.__engine!.buildingStats());
  await page.evaluate((kinds) => {
    const a = window.__engine!;
    kinds.forEach((kind, i) => {
      a.setTerrain(`test-stone-${kind}`);
      a.buildAt(20 + i * 2, 12);
    });
  }, [...KINDS]);
  await page.getByLabel('Build X', { exact: true }).fill('23');
  await page.getByLabel('Build Y', { exact: true }).fill('12');
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__engine!.buildingStats().tiles), { timeout: 15_000 }).toBe(before.tiles + 4);
  // Drawn in the material once its maps are in: every part of the four pieces textured.
  await expect.poll(() => page.evaluate(() => window.__engine!.buildingStats().textured), { timeout: 30_000 }).toBeGreaterThanOrEqual(4);
  // Compressed: every one of them drawn from maps the GPU holds in its own format.
  const drawn = await page.evaluate(() => window.__engine!.buildingStats());
  expect(drawn.compressed).toBe(drawn.textured);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/tile-surfaces.png' });
  // Close up, beside a run of wall and a patch of floor, to see the material read as depth.
  await page.evaluate(() => {
    const a = window.__engine!;
    a.setTerrain('test-stone-wall');
    for (let x = 20; x <= 26; x++) a.buildAt(x, 15);
    a.setTerrain('test-stone-floor');
    for (let x = 20; x <= 26; x++) for (let y = 13; y <= 14; y++) a.buildAt(x, y);
  });
  const middle = await page.evaluate(() => window.__engine!.buildScreenAt(23, 13));
  await page.mouse.move(middle.x, middle.y);
  for (let n = 0; n < 6; n++) await page.mouse.wheel(0, -300);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/tile-surfaces-near.png' });

  // Written out and read back, the material and its tiles are still there, and drawn in it.
  const text = await page.evaluate(() => window.__engine!.exportProject());
  const written = JSON.parse(text) as { surfaces?: { id: string; maps: Record<string, string> }[]; terrainPalette?: { id: string; surface?: string }[] };
  expect(written.surfaces?.map((s) => s.id)).toEqual(['test-stone']);
  const maps = written.surfaces![0]!.maps;
  for (const map of Object.values(maps)) expect(map.startsWith('data:image/ktx2;base64,')).toBe(true);
  expect(written.terrainPalette?.filter((k) => k.surface === 'test-stone')).toHaveLength(4);
  expect(await page.evaluate((saved) => window.__engine!.loadProjectText(saved), text)).toBe('');
  await expect.poll(() => page.evaluate(() => window.__engine!.buildingStats().textured), { timeout: 30_000 }).toBeGreaterThanOrEqual(4);
  // And played: the same pieces, drawn the same way.
  await page.evaluate(() => window.__engine!.setMode('play'));
  await expect.poll(() => page.evaluate(() => window.__engine!.buildingStats().textured), { timeout: 30_000 }).toBeGreaterThanOrEqual(4);
  expect(failed).toEqual([]);
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});

test('a material imported before its maps were compressed is compressed in place, from its own page', async ({ page }) => {
  test.setTimeout(120_000);
  const failed: string[] = [];
  page.on('console', (message) => {
    if (glFailure(message)) failed.push(message.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.getByTestId('mode-terrain').click();
  await page.getByTestId('open-content').click();
  await page.getByTestId('open-tiles').click();
  await page.getByTestId('surface-file').setInputFiles(ZIP);
  await expect(page.getByTestId('surface-status')).toContainText('Imported Test Stone', { timeout: 30_000 });
  await page.getByTestId('close-tiles').click();

  // The maps made plain images, as a material imported before compression has them, and read back.
  const pngs = unzipSync(readFileSync(ZIP));
  const png = (name: string) => `data:image/png;base64,${Buffer.from(pngs[`TestStone_1K-PNG_${name}.png`]!).toString('base64')}`;
  const written = JSON.parse(await page.evaluate(() => window.__engine!.exportProject())) as { surfaces: { maps: Record<string, string> }[] };
  written.surfaces[0]!.maps = { color: png('Color'), normalHeight: png('NormalGL'), orm: png('AmbientOcclusion') };
  expect(await page.evaluate((text) => window.__engine!.loadProjectText(text), JSON.stringify(written))).toBe('');
  await page.getByTestId('mode-terrain').click();
  await page.evaluate(() => {
    const a = window.__engine!;
    a.setTerrain('test-stone-block');
    a.buildAt(20, 12);
    a.buildAt(22, 12);
  });
  await expect.poll(() => page.evaluate(() => window.__engine!.buildingStats().textured), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => window.__engine!.buildingStats().compressed)).toBe(0);

  await page.getByTestId('open-content').click();
  await page.getByTestId('open-tiles').click();
  await page.locator('[data-surface="test-stone"]').click();
  await expect(page.getByTestId('surface-uncompressed')).toBeVisible();
  await page.getByTestId('surface-compress').click();
  await expect(page.getByTestId('surface-status')).toHaveText('Compressed Test Stone for the graphics card.', { timeout: 30_000 });
  await expect(page.getByTestId('surface-uncompressed')).toHaveCount(0);
  await page.getByTestId('close-tiles').click();
  const after = JSON.parse(await page.evaluate(() => window.__engine!.exportProject())) as { surfaces: { maps: Record<string, string> }[] };
  for (const map of Object.values(after.surfaces[0]!.maps)) expect(map.startsWith('data:image/ktx2;base64,')).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__engine!.buildingStats().compressed), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  expect(failed).toEqual([]);
});

test('a kind of ground drawn in a material: every cell of it, from the material\u2019s page; a block of it tinted its kind’s colour; undone a step at a time', async ({ page }) => {
  test.setTimeout(120_000);
  const failed: string[] = [];
  page.on('console', (message) => {
    if (glFailure(message)) failed.push(message.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.getByTestId('mode-terrain').click();
  await page.getByTestId('open-content').click();
  await page.getByTestId('open-tiles').click();
  await page.getByTestId('surface-file').setInputFiles(ZIP);
  await expect(page.getByTestId('surface-status')).toContainText('Imported Test Stone', { timeout: 30_000 });
  expect(await page.evaluate(() => window.__engine!.groundSurfaces())).toEqual([]);
  await page.getByTestId('surface-ground-floor').locator('input').check();
  await expect.poll(() => page.evaluate(() => window.__engine!.groundSurfaces()), { timeout: 30_000 }).toEqual(['floor']);
  await page.getByTestId('close-tiles').click();
  const middle = await page.evaluate(() => window.__engine!.buildScreenAt(10, 10));
  await page.mouse.move(middle.x, middle.y);
  for (let n = 0; n < 4; n++) await page.mouse.wheel(0, -300);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/tile-surfaces-ground.png' });
  // Tinted: a block of it takes its kind's colour, made blue, its average that colour. The same patch of pixels read
  // before and after, the pointer off the board so no hover lights it, and the stone's own detail cancels out.
  await page.evaluate(() => {
    const a = window.__engine!;
    a.setTerrain('test-stone-block');
    a.buildAt(23, 12);
  });
  await page.getByLabel('Build X', { exact: true }).fill('23');
  await page.getByLabel('Build Y', { exact: true }).fill('12');
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__engine!.buildingStats().textured), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  const block = await page.evaluate(() => window.__engine!.buildScreenAt(23, 12));
  await page.mouse.move(block.x, block.y);
  for (let n = 0; n < 5; n++) await page.mouse.wheel(0, -300);
  await page.waitForTimeout(600);
  const at = await page.evaluate(() => window.__engine!.buildScreenAt(23, 12));
  await page.mouse.move(1200, 780);
  const patch = (): Promise<number[]> => page.evaluate(({ x, y }) => {
    const a = window.__engine!;
    const canvas = document.getElementById('gl') as HTMLCanvasElement;
    const box = canvas.getBoundingClientRect();
    const scale = canvas.width / box.width;
    const [gx, gy] = [Math.round((x - box.left) * scale), Math.round(canvas.height - (y - box.top) * scale)];
    const sum = [0, 0, 0];
    for (let dx = -8; dx <= 8; dx += 4) for (let dy = -8; dy <= 8; dy += 4) a.sample(gx + dx, gy + dy).slice(0, 3).forEach((v, i) => (sum[i]! += v / 25));
    return sum;
  }, at);
  const own = await patch();
  await page.getByTestId('open-content').click();
  await page.getByTestId('open-tiles').click();
  await page.locator('[data-tile="test-stone-block"]').click();
  await page.getByTestId('tile-color').fill('#2255cc');
  await page.locator('[data-surface="test-stone"]').click();
  await page.getByTestId('surface-tint').fill('1');
  // The repeat typed, finer than the slider steps: kept as typed; a size the schema refuses left as it was.
  await page.getByTestId('surface-size-typed').fill('2.4');
  await page.getByTestId('surface-size-typed').press('Enter');
  await expect(page.getByTestId('surface-size').locator('xpath=..')).toContainText('2.4');
  await page.getByTestId('surface-size-typed').fill('40');
  await page.getByTestId('surface-size-typed').press('Enter');
  await expect(page.getByTestId('surface-size-typed')).toHaveValue('2.4');
  await page.getByTestId('close-tiles').click();
  await page.mouse.move(1200, 780);
  await page.waitForTimeout(600);
  const tinted = await patch();
  await page.screenshot({ path: 'test-results/tile-surfaces-tinted.png' });
  // Blue leads where it did not, by a margin a stone's grey never has.
  const said = `own ${own.map(Math.round)}, tinted ${tinted.map(Math.round)}`;
  expect(tinted[2]! - tinted[0]!, said).toBeGreaterThan(own[2]! - own[0]! + 20);
  expect(tinted[2]!, said).toBeGreaterThan(tinted[1]!);
  // The block's kind given its own repeat, smaller than the material's: drawn at it, the material's own untouched.
  expect(await page.evaluate(() => window.__engine!.buildingStats().looks)).toEqual(['test-stone']);
  await page.getByTestId('open-content').click();
  await page.getByTestId('open-tiles').click();
  await page.locator('[data-tile="test-stone-block"]').click();
  await expect(page.getByTestId('tile-surface-size')).toHaveAttribute('placeholder', "the material's: 2.4");
  await page.getByTestId('tile-surface-size').fill('0.5');
  await page.getByTestId('tile-surface-size').press('Enter');
  await page.getByTestId('close-tiles').click();
  await expect.poll(() => page.evaluate(() => window.__engine!.buildingStats().looks), { timeout: 15_000 }).toEqual(['test-stone@0.5']);
  await page.screenshot({ path: 'test-results/tile-surfaces-repeat.png' });
  // Undone a step at a time: the repeat, the size, the tint, the colour, the block, the ground.
  expect(await page.evaluate(() => window.__engine!.undo())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__engine!.buildingStats().looks), { timeout: 15_000 }).toEqual(['test-stone']);
  for (let n = 0; n < 5; n++) expect(await page.evaluate(() => window.__engine!.undo())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__engine!.groundSurfaces()), { timeout: 15_000 }).toEqual([]);
  expect(failed).toEqual([]);
});
