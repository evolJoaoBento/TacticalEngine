import { expect, test } from '@playwright/test';

/**
 * A second click interrupts the first.
 *
 * A walk resolves the moment it is ordered - the document goes to the end of the line and the
 * gliding is only the drawing of it - so until this slice a click during a walk was measured from
 * a tile the figure had not reached. The new line was planned from there, and the figure set off
 * towards the place it was abandoning in order to join it.
 *
 * Everything here is watched from inside the page. Polling across the wire starves the frames, and
 * a starved frame advances the glide by up to half a second, so a walk of four seconds finishes in
 * three reads and there is no middle of it left to look at.
 */

/** Wait, in the page, for the figure to be this far from where it set off. */
const PARTWAY = `(async (want) => {
  const api = window.__engine;
  const start = api.standingNow('kara');
  return await new Promise((resolve) => {
    const tick = () => {
      const now = api.standingNow('kara');
      if (Math.hypot(now.x - start.x, now.y - start.y) >= want) return resolve(now);
      if (api.gliding() === 0) return resolve(null);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
})`;

test('a click during a walk stops the character where they are and goes on from there', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 30);
  await page.evaluate(() => {
    const api = window.__engine!;
    api.setDiceSpeed(0);
    api.select('kara');
  });

  const from = (await page.evaluate(() => window.__engine!.standingAt('kara')))!;
  // Standing still, the figure is exactly where the document says: the two only differ mid-walk.
  expect(await page.evaluate(() => window.__engine!.standingNow('kara'))).toEqual({ x: from.x, y: from.y });

  // The longest walk this room offers, asked for rather than guessed: there is a wall down the
  // middle of it and a stream through the trees, so an offset picked by hand stops after a tile.
  const away = (await page.evaluate((start) => {
    const api = window.__engine!;
    let best: { x: number; y: number } | null = null;
    let longest = 0;
    for (let dx = -8; dx <= 8; dx++) {
      for (let dy = 2; dy <= 12; dy++) {
        const to = { x: start.x + dx, y: start.y + dy };
        const preview = api.previewAt(to.x, to.y);
        if (preview === null || preview.beyond.length > 0) continue;
        const walked = preview.route.reduce((sum, spot, i) => (i === 0 ? 0 : sum + Math.hypot(spot.x - preview.route[i - 1]!.x, spot.y - preview.route[i - 1]!.y)), 0);
        if (walked > longest) {
          longest = walked;
          best = to;
        }
      }
    }
    return best;
  }, from))!;
  expect(away, 'no long walk on this map to interrupt').not.toBeNull();

  const there = await page.evaluate((to) => window.__engine!.screenAt(to.x, to.y), away);
  await page.mouse.click(there.x, there.y);

  // Part-way along: the document has arrived, the figure has not.
  const mid = (await page.evaluate(`${PARTWAY}(2.5)`)) as { x: number; y: number } | null;
  expect(mid, 'the walk ended before there was a middle of it to interrupt').not.toBeNull();
  const seen = await page.evaluate(() => ({ document: window.__engine!.standingAt('kara')!, gliding: window.__engine!.gliding() }));
  expect(seen.gliding).toBeGreaterThan(0);
  expect(
    Math.hypot(seen.document.x - mid!.x, seen.document.y - mid!.y),
    'the figure should still be behind the document mid-walk',
  ).toBeGreaterThan(1);

  // Back the way they came, which is the other side of the figure from where they were going.
  const back = { x: Math.round((from.x + mid!.x) / 2), y: Math.round((from.y + mid!.y) / 2) };

  // The line drawn for that click starts at the body, not at the tile the first walk was aiming
  // at. This is the whole of the second rule, and it is what the player is looking at.
  const drawn = (await page.evaluate((to) => window.__engine!.previewAt(to.x, to.y), back))!;
  expect(drawn, 'nothing drawn for a spot behind them').not.toBeNull();
  const head = drawn.route[0]!;
  expect(Math.hypot(head.x - mid!.x, head.y - mid!.y), 'the line was drawn from the document, not the body').toBeLessThan(1.2);
  expect(Math.hypot(head.x - seen.document.x, head.y - seen.document.y)).toBeGreaterThan(1);

  // The click itself, and then every frame of what follows: the figure may never head back
  // towards the place it was told to abandon. Planning the new walk from the document rather
  // than from the body is exactly what makes it do that.
  const wasFrom = Math.hypot(mid!.x - away.x, mid!.y - away.y);
  const other = await page.evaluate((to) => window.__engine!.screenAt(to.x, to.y), back);
  await page.mouse.click(other.x, other.y);
  const closest = await page.evaluate((target) => new Promise<number>((resolve) => {
    const api = window.__engine!;
    let nearest = Infinity;
    const tick = () => {
      const now = api.standingNow('kara')!;
      nearest = Math.min(nearest, Math.hypot(now.x - target.x, now.y - target.y));
      if (api.gliding() === 0) return resolve(nearest);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), away);
  expect(closest, 'the figure doubled back towards the walk it had been taken off').toBeGreaterThan(wasFrom - 1);

  // And it is standing where the second click asked, not where the first one did.
  const ended = await page.evaluate(() => window.__engine!.standingNow('kara')!);
  expect(Math.hypot(ended.x - back.x, ended.y - back.y), 'it did not finish the walk it was given').toBeLessThan(2);
  expect(Math.hypot(ended.x - away.x, ended.y - away.y), 'it finished the walk it was told to abandon').toBeGreaterThan(1.5);
});

test('the line keeps up with a walking figure under a pointer that never moves', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 30);
  await page.evaluate(() => {
    const api = window.__engine!;
    api.setDiceSpeed(0);
    api.select('kara');
  });

  const from = (await page.evaluate(() => window.__engine!.standingAt('kara')))!;
  const away = (await page.evaluate((start) => {
    const api = window.__engine!;
    let best: { x: number; y: number } | null = null;
    let longest = 0;
    for (let dx = -8; dx <= 8; dx++) {
      for (let dy = 2; dy <= 12; dy++) {
        const to = { x: start.x + dx, y: start.y + dy };
        const preview = api.previewAt(to.x, to.y);
        if (preview === null || preview.beyond.length > 0) continue;
        const walked = preview.route.reduce((sum, spot, i) => (i === 0 ? 0 : sum + Math.hypot(spot.x - preview.route[i - 1]!.x, spot.y - preview.route[i - 1]!.y)), 0);
        if (walked > longest) {
          longest = walked;
          best = to;
        }
      }
    }
    return best;
  }, from))!;

  // Hover it, and the line is on the ground before anything is clicked.
  const there = await page.evaluate((to) => window.__engine!.screenAt(to.x, to.y), away);
  await page.mouse.move(there.x, there.y, { steps: 10 });
  await expect.poll(async () => page.evaluate(() => window.__engine!.pathPoints()), { timeout: 15_000 }).toBeGreaterThan(4);

  // Click once and then do not touch the mouse again. The pointer is still resting on the same
  // spot, so nothing will move it: only the walk changes what the line should say.
  await page.mouse.down();
  await page.mouse.up();

  const trace = await page.evaluate(() => new Promise<number[]>((resolve) => {
    const api = window.__engine!;
    const seen: number[] = [];
    const tick = (): void => {
      seen.push(api.pathPoints());
      if (api.gliding() === 0) return resolve(seen);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));

  expect(trace.length, 'the walk was over before it could be watched').toBeGreaterThan(20);
  // Drawn again after the click cleared it: the pointer never moved, so nothing else would have.
  const drawn = trace.filter((points) => points > 0);
  expect(drawn.length, 'the line was never redrawn while they walked').toBeGreaterThan(5);
  // And it is shorter by the end, because it is measured from a figure that has been closing on
  // the spot the whole time. A line that is never recomputed keeps whatever length it was.
  const first = drawn[0]!;
  const last = drawn[drawn.length - 1]!;
  expect(last, `the line did not shrink as they walked: ${first} then ${last}`).toBeLessThan(first);
  expect(new Set(drawn).size, 'the line held one length the whole way').toBeGreaterThan(2);
});
