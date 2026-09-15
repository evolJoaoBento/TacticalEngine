import { test, expect } from '@playwright/test';

/**
 * A placed creature is picked up and put down with the mouse, in the editor's Combat mode, with the
 * tool Combat opens on: a press on the creature takes hold of it, the drag carries it, letting go
 * drops it, and one undo puts it back.
 */
test('drags a placed creature to another tile, and one undo puts it back', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.getByTestId('mode-combat').click();

  type Doc = {
    scenes: { width: number; height: number; encounters: { adversaries: { id: string; position: { x: number; y: number } }[] }[] }[];
  };
  const plan = await page.evaluate(() => {
    const api = window.__engine!;
    const scene = (JSON.parse(api.exportProject()) as Doc).scenes[0]!;
    const all = scene.encounters.flatMap((e) => e.adversaries);
    const creature = all[0]!;
    const taken = new Set(all.map((p) => `${p.position.x},${p.position.y}`));
    // Two tiles off in some direction, inside the room and with nobody standing there.
    const target = [[-2, 0], [2, 0], [0, 2], [0, -2]]
      .map(([dx, dy]) => ({ x: creature.position.x + dx!, y: creature.position.y + dy! }))
      .find((p) => p.x >= 0 && p.y >= 0 && p.x < scene.width && p.y < scene.height && !taken.has(`${p.x},${p.y}`))!;
    const tile = (p: { x: number; y: number }) => p.y * scene.width + p.x;
    return {
      id: creature.id,
      count: all.length,
      from: creature.position,
      to: target,
      fromScreen: api.screenOf(tile(creature.position)),
      toScreen: api.screenOf(tile(target)),
    };
  });

  await page.mouse.move(plan.fromScreen.x, plan.fromScreen.y);
  await page.mouse.down();
  await page.mouse.move(plan.toScreen.x, plan.toScreen.y, { steps: 10 });
  await page.mouse.up();

  const where = () =>
    page.evaluate((id) => {
      const scene = (JSON.parse(window.__engine!.exportProject()) as Doc).scenes[0]!;
      const all = scene.encounters.flatMap((e) => e.adversaries);
      const found = all.find((p) => p.id === id)!;
      return { count: all.length, at: { x: found.position.x, y: found.position.y } };
    }, plan.id);

  // Moved, not copied: the room holds as many creatures as before.
  expect(await where()).toEqual({ count: plan.count, at: plan.to });

  await page.keyboard.press('Control+z');
  expect(await where()).toEqual({ count: plan.count, at: { x: plan.from.x, y: plan.from.y } });
  expect(errors).toEqual([]);
});
