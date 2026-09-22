import { expect, test } from '@playwright/test';

/**
 * Movement in a fight is a distance, spent along the line walked: a click past it walks as
 * far as it goes and stops there, on the line, part-way into whatever tile that is.
 */

test('in a fight the ground is a circle: free inside it, a push with a warning past it, and the turn lost on a failure', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);

  const read = await page.evaluate(() => {
    const api = window.__engine!;
    api.setDiceSpeed(0);
    api.select('kara');
    api.startFight();
    const from = api.standingAt('kara')!;
    // Across the field and up it - clear of the hand of cards, which lies over the near edge - to a spot outside Close.
    const aim = { x: from.x + 6.3, y: from.y - 3.4 };
    return { from, aim, preview: api.previewAt(aim.x, aim.y), lit: api.reachable().length, push: api.underPressure().length };
  });
  expect(read.preview).not.toBeNull();
  const { route, beyond } = read.preview!;
  const away = (p: { x: number; y: number }): number => Math.hypot(p.x - read.from.x, p.y - read.from.y);
  // As far as the circle of Close goes - four and a half tiles from where she stood - and the rest of the line past that, in the push's colour.
  expect(away(route.at(-1)!)).toBeGreaterThan(4.3);
  expect(away(route.at(-1)!)).toBeLessThanOrEqual(4.5001);
  expect(beyond[0]).toEqual(route.at(-1));
  expect(read.preview!.run).toBe(true);
  expect(read.lit).toBeGreaterThan(1);
  expect(read.push).toBeGreaterThan(0);

  // The circle on the ground, and the line under the pointer.
  const at = await page.evaluate((aim) => window.__engine!.screenAt(aim.x, aim.y), read.aim);
  await page.mouse.move(at.x, at.y - 6);
  await page.mouse.move(at.x, at.y, { steps: 3 });
  await expect.poll(() => page.evaluate(() => window.__engine!.pathPoints())).toBeGreaterThan(1);
  await page.screenshot({ path: 'test-results/move-circle.png' });

  // Two moves inside the circle cost nothing, and the circle does not move with her.
  const free = await page.evaluate((from) => {
    const api = window.__engine!;
    const before = api.reachable().length;
    api.walkTo(from.x + 2, from.y);
    api.walkTo(from.x + 3.5, from.y + 1);
    return { before, after: api.reachable().length, pending: api.pendingKind(), inCombat: api.inCombat(), at: api.standingAt('kara')! };
  }, read.from);
  expect(free.pending).toBeNull();
  expect(free.after).toBe(free.before);
  expect(Math.hypot(free.at.x - read.from.x - 3.5, free.at.y - read.from.y - 1)).toBeLessThan(0.75);

  // Past the circle: a roll is asked, and the card warns that a failure hands the spotlight over.
  const asked = await page.evaluate((aim) => {
    const api = window.__engine!;
    api.walkTo(aim.x, aim.y);
    return api.pendingKind();
  }, read.aim);
  expect(asked).toBe('check');
  await expect(page.locator('.roll-backdrop')).toContainText(/spotlight passes to the GM/);
  await page.screenshot({ path: 'test-results/move-push.png' });
  const outcome = await page.evaluate(() => {
    const api = window.__engine!;
    api.answer({ kind: 'roll' });
    while (api.pendingKind() === 'choice') api.answer({ kind: 'choose', index: 0 });
    const text = api.log().slice(-6).map((line) => line.text).join(' | ');
    return { text, at: api.standingAt('kara')!, side: /passes to the GM/.test(text) ? 'gm' : 'party' };
  });
  // Either the circle opened to Far and she went, or nobody moved and the room has the spotlight.
  if (outcome.side === 'gm') {
    expect(Math.hypot(outcome.at.x - free.at.x, outcome.at.y - free.at.y)).toBeLessThan(1e-6);
  } else {
    expect(outcome.text).toMatch(/pushes out to Far range/);
    expect(away(outcome.at)).toBeGreaterThan(4.5);
  }
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});

test('a click at her own feet is a step to one side, and a jump lands on the spot it was aimed at', async ({ page }) => {
  test.setTimeout(300_000);
  // The dice thrown for her, so the jump does not wait on a card.
  await page.addInitScript(() => localStorage.setItem('tactical-engine:user-settings', JSON.stringify({ autoRollJumps: true })));
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => {
    window.__engine!.setDiceSpeed(0);
    window.__engine!.select('kara');
  });

  // A third of a tile east of where she stands: inside her own square, and inside the half tile a click used to give to her.
  const stood = (await page.evaluate(() => window.__engine!.standingAt('kara')))!;
  const tile = await page.evaluate(() => window.__engine!.tileOf('kara'));
  const beside = await page.evaluate((at) => window.__engine!.screenAt(at.x + 0.3, at.y), stood);
  await page.mouse.click(beside.x, beside.y);
  await expect.poll(() => page.evaluate(() => window.__engine!.gliding()), { timeout: 30_000 }).toBe(0);
  const stepped = (await page.evaluate(() => window.__engine!.standingAt('kara')))!;
  expect(stepped.x - stood.x).toBeGreaterThan(0.15);
  expect(stepped.x - stood.x).toBeLessThan(0.45);
  expect(Math.abs(stepped.y - stood.y)).toBeLessThan(0.15);
  expect(await page.evaluate(() => window.__engine!.tileOf('kara'))).toBe(tile);

  // And a jump, aimed off the middle of a square three tiles on: she comes down where the pointer was.
  const aim = { x: Math.round(stepped.x) + 3.3, y: Math.round(stepped.y) - 0.25 };
  await page.getByTestId('jump-button').click();
  const at = await page.evaluate((spot) => window.__engine!.screenAt(spot.x, spot.y), aim);
  await page.mouse.move(at.x, at.y - 8);
  await page.mouse.move(at.x, at.y, { steps: 3 });
  await expect.poll(() => page.evaluate(() => window.__engine!.arc())).toBe('ok');
  await page.screenshot({ path: 'test-results/jump-to-a-spot.png' });
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => page.evaluate(() => window.__engine!.gliding()), { timeout: 40_000 }).toBe(0);
  const landed = (await page.evaluate(() => window.__engine!.standingAt('kara')))!;
  expect(Math.hypot(landed.x - aim.x, landed.y - aim.y)).toBeLessThan(0.15);
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});

test('a right click while a jump is being aimed puts the jump down', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.select('kara'));
  const button = page.getByTestId('jump-button');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  const stood = (await page.evaluate(() => window.__engine!.standingAt('kara')))!;
  const at = await page.evaluate((spot) => window.__engine!.screenAt(spot.x + 2, spot.y), stood);
  await page.mouse.move(at.x, at.y - 6);
  await page.mouse.move(at.x, at.y, { steps: 3 });
  await expect.poll(() => page.evaluate(() => window.__engine!.arc())).toBe('ok');
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => page.evaluate(() => window.__engine!.arc())).toBeNull();
  // Nothing was inspected for it, and she has not moved.
  expect(await page.getByTestId('inspect').count()).toBe(0);
  expect(await page.evaluate(() => window.__engine!.standingAt('kara'))).toEqual(stood);
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});
