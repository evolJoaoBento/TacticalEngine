import { expect, test } from '@playwright/test';

/**
 * Select in the Terrain tab takes hold of a piece of building: press on it, drag it across the
 * board, let go - and it stands where it was dropped, ground the party can walk onto.
 */

test('a placed platform is picked up with Select, carried and put down somewhere else', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.getByTestId('mode-terrain').click();

  // A platform laid on an open cell of the field, one block up so it reads as a slab.
  await page.evaluate(() => window.__engine!.setTerrain('platform'));
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Raise build level', exact: true }).click();
  expect(await page.evaluate(() => window.__engine!.buildAt(4, 4))).toBe(true);
  const laid = async (): Promise<Record<string, { x: number; y: number; level: number }>> => {
    const [text, api] = await page.evaluate(() => [window.__engine!.exportProject(), window.__engine!.editScene()]);
    const scene = JSON.parse(text).scenes.find((s: { id: string }) => s.id === api);
    return Object.fromEntries(Object.entries(scene.buildingTiles as Record<string, { x: number; y: number; level: number; tile?: string }>).filter(([, p]) => p.tile === 'platform' && p.level === 1));
  };
  expect(Object.keys(await laid())).toEqual(['4,4,1']);

  // Select, press on it, drag it four tiles east, let go.
  await page.evaluate(() => window.__engine!.setTool('select'));
  const from = await page.evaluate(() => window.__engine!.buildScreenAt(4, 4));
  const to = await page.evaluate(() => window.__engine!.buildScreenAt(8, 4));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.screenshot({ path: 'test-results/pick-up-carried.png' });
  await page.mouse.up();
  expect(Object.keys(await laid())).toEqual(['8,4,1']);
  await page.screenshot({ path: 'test-results/pick-up-dropped.png' });

  // It is ground where it landed and nothing where it was: a step up onto it from the floor.
  await page.evaluate(() => window.__engine!.setMode('play'));
  await page.evaluate(() => window.__engine!.select('kara'));
  const reach = await page.evaluate(() => window.__engine!.reachable());
  // A block up is a jump, not a walk: where it landed is out of a walk's reach, and where it was is floor again.
  expect(reach).not.toContain(4 * 44 + 8);
  expect(reach).toContain(4 * 44 + 4);
  // And one undo puts it back.
  await page.evaluate(() => window.__engine!.setMode('edit'));
  expect(await page.evaluate(() => window.__engine!.undo())).toBe(true);
  expect(Object.keys(await laid())).toEqual(['4,4,1']);
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});
