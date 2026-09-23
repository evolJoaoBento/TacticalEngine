import { expect, test } from '@playwright/test';

/**
 * Holding the button walks whoever is selected towards the pointer, a step at a time, and keeps
 * the camera on them; letting go is not a click on wherever the pointer ended up.
 */

test('a held button walks the selected character towards the pointer, with the camera on them', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5, null, { timeout: 60_000 });

  const start = await page.evaluate(() => {
    const api = window.__engine!;
    api.setDiceSpeed(0);
    api.select('kara');
    return { from: api.standingAt('kara')!, camera: api.camera(), selected: api.selected(), view: { w: window.innerWidth, h: window.innerHeight } };
  });
  expect(start.selected).toBe('kara');

  // Holding puts the camera on her, so the pointer is aimed from the middle of the screen: down and
  // to the right of it is south-east on the board, into the open woods.
  const px = { x: start.view.w / 2 + 210, y: start.view.h / 2 + 120 };
  await page.mouse.move(px.x, px.y);
  await page.mouse.down();
  // Held, and watched from inside the page: a walk is measured while the button is down, and asking
  // across the wire every tenth of a second starves the frames the walk is taken on.
  const paced = await page.evaluate(async () => {
    const api = window.__engine!;
    await new Promise((r) => setTimeout(r, 700)); // the hold, and a step or two of it
    const first = { at: api.standingAt('kara')!, clock: performance.now() };
    await new Promise((r) => setTimeout(r, 2000));
    const last = { at: api.standingAt('kara')!, clock: performance.now() };
    return { tiles: Math.hypot(last.at.x - first.at.x, last.at.y - first.at.y), seconds: (last.clock - first.clock) / 1000, at: last.at };
  });
  // They went somewhere, and at a walk rather than a sprint: the ground covered over a spell of
  // holding is the ground a walk covers in that time. Sized by distance instead, it ran eight times this.
  expect(Math.hypot(paced.at.x - start.from.x, paced.at.y - start.from.y)).toBeGreaterThan(3);
  const pace = paced.tiles / paced.seconds;
  expect(pace).toBeGreaterThan(1.6);
  expect(pace).toBeLessThan(3.4);
  await page.mouse.up();

  const after = await page.evaluate(() => {
    const api = window.__engine!;
    return { at: api.standingAt('kara')!, camera: api.camera(), selected: api.selected(), pending: api.pendingKind(), inCombat: api.inCombat() };
  });
  // South-east, the way the pointer pointed, and nothing was asked of the player on the way.
  expect(after.at.x).toBeGreaterThan(start.from.x);
  expect(after.at.y).toBeGreaterThan(start.from.y);
  expect(after.pending).toBeNull();
  expect(after.inCombat).toBe(false);
  // The camera came with them rather than staying where the room began.
  const moved = Math.hypot(after.camera.target.x - start.camera.target.x, after.camera.target.z - start.camera.target.z);
  expect(moved).toBeGreaterThan(1);
  // Letting go after a walk is not a click: nobody else was selected by it.
  expect(after.selected).toBe('kara');
  await page.screenshot({ path: 'test-results/steer-walked.png', timeout: 120_000 });

  // The others came along behind, in a line: a pace back, two paces back, and none of them adrift
  // or standing on anybody. Before the trail they were re-placed on every step, which read as the
  // party scattering and hopping about.
  const line = await page.evaluate(() => {
    const api = window.__engine!;
    const at = (id: string) => api.standingAt(id)!;
    const leader = at('kara');
    return api.party().filter((id) => id !== 'kara').map((id) => Math.hypot(at(id).x - leader.x, at(id).y - leader.y)).sort((a, b) => a - b);
  });
  expect(line.length).toBeGreaterThan(1);
  expect(line[0]).toBeGreaterThan(0.6);
  // A pace or so each, so the line is as long as the party is: the last of six is five paces back.
  expect(line[line.length - 1]).toBeLessThan(1.6 * line.length);
  for (let i = 1; i < line.length; i++) expect(line[i]! - line[i - 1]!).toBeGreaterThan(0.4);

  // A press that does not linger is still a click: this one walks to where it was let go.
  await page.waitForFunction(() => window.__engine!.gliding() === 0, null, { timeout: 30_000 });
  // The camera is still easing after the walk; a screen point taken mid-ease aims at another tile.
  await expect
    .poll(async () => {
      const first = await page.evaluate(() => window.__engine!.camera());
      await page.waitForTimeout(120);
      const second = await page.evaluate(() => window.__engine!.camera());
      return JSON.stringify(first) === JSON.stringify(second);
    }, { timeout: 30_000 })
    .toBe(true);
  const clicked = await page.evaluate(() => {
    const api = window.__engine!;
    const at = api.standingAt('kara')!;
    // Ground she can actually stand on, a few tiles off: the woods have an outcrop that wants a
    // jump and a stream that does not, so a spot picked by offset alone is not always walkable.
    const away = (t: number): number => Math.hypot((t % 44) - at.x, Math.floor(t / 44) - at.y);
    // Clear of the others as well: a click on somebody selects them, which is not what this asks.
    const others = api.party().filter((id) => id !== 'kara').map((id) => api.standingAt(id)!);
    const clear = (t: number): boolean => others.every((o) => Math.hypot((t % 44) - o.x, Math.floor(t / 44) - o.y) > 1.6);
    const tile = api.reachable().filter((t) => away(t) > 2 && away(t) < 3.5 && clear(t)).sort((x, y) => away(x) - away(y))[0]!;
    return { to: { x: tile % 44, y: Math.floor(tile / 44) }, px: api.screenOf(tile) };
  });
  await page.mouse.click(clicked.px.x, clicked.px.y);
  expect(await page.evaluate(() => window.__engine!.selected())).toBe('kara');
  await expect
    .poll(async () => page.evaluate((to) => {
      const at = window.__engine!.standingAt('kara')!;
      return Math.hypot(at.x - to.x, at.y - to.y);
    }, clicked.to), { timeout: 30_000 })
    .toBeLessThan(0.75);
});
