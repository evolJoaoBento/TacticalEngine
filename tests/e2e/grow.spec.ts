import { expect, test } from '@playwright/test';

/**
 * Tiles laid outside the room make the room bigger: they are floor, somebody can walk out
 * onto them, nothing on screen jumps when it happens, and one undo takes it all back.
 */

test('a platform laid past the west edge grows the room, and the party can walk out onto it', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setDiceSpeed(0));

  const sceneNow = (): Promise<{ width: number; height: number; origin?: { x: number; y: number }; voids: number }> =>
    page.evaluate(() => {
      const api = window.__engine!;
      const scene = JSON.parse(api.exportProject()).scenes.find((s: { id: string }) => s.id === api.editScene());
      return { width: scene.width, height: scene.height, origin: scene.origin, voids: scene.terrain.filter((id: string) => id === 'void').length };
    });

  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.getByTestId('mode-terrain').click();
  await page.evaluate(() => window.__engine!.setTerrain('platform'));
  const before = await sceneNow();
  const stood = await page.evaluate(() => window.__engine!.standingAt('kara'));
  const seen = await page.evaluate((at) => window.__engine!.screenAt(at!.x, at!.y), stood);
  await page.screenshot({ path: 'test-results/grow-before.png' });

  // Two tiles out from the west edge, in a row from it: each click is a stroke, and each grows the room by one.
  expect(await page.evaluate(() => window.__engine!.buildAt(-1, 6))).toBe(true);
  expect(await page.evaluate(() => window.__engine!.buildAt(-1, 6))).toBe(true);
  const after = await sceneNow();
  expect(after).toEqual({ width: before.width + 2, height: before.height, origin: { x: 2, y: 0 }, voids: 2 * before.height });

  // Everybody is where they were, under new numbers - and on screen, exactly where they were.
  const standing = await page.evaluate(() => window.__engine!.standingAt('kara'));
  expect(standing).toEqual({ x: stood!.x + 2, y: stood!.y });
  const still = await page.evaluate((at) => window.__engine!.screenAt(at!.x, at!.y), standing);
  expect(Math.abs(still.x - seen.x)).toBeLessThan(2);
  expect(Math.abs(still.y - seen.y)).toBeLessThan(2);
  await page.screenshot({ path: 'test-results/grow-after.png' });

  // Out onto it, in play: the far tile of the two is floor now.
  await page.evaluate(() => window.__engine!.setMode('play'));
  await page.evaluate(() => window.__engine!.select('kara'));
  const width = after.width;
  expect(await page.evaluate((tile) => window.__engine!.moveTo(tile), 6 * width)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__engine!.gliding()), { timeout: 60_000 }).toBe(0);
  expect(await page.evaluate(() => window.__engine!.tileOf('kara'))).toBe(6 * width);
  await page.screenshot({ path: 'test-results/grow-walked.png' });

  // One undo per stroke, and the room is the size it was - with her back where the party comes in.
  await page.evaluate(() => window.__engine!.setMode('edit'));
  expect(await page.evaluate(() => window.__engine!.undo())).toBe(true);
  expect(await page.evaluate(() => window.__engine!.undo())).toBe(true);
  expect(await sceneNow()).toEqual({ width: before.width, height: before.height, origin: undefined, voids: 0 });
  expect(await page.evaluate(() => window.__engine!.tileOf('kara'))).toBeGreaterThanOrEqual(0);
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});
