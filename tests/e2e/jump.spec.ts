import { expect, test, type Page } from '@playwright/test';

/**
 * Jumping, in the real page. A click on the ground is a walk and never a jump; the key beside
 * the Light is how a jump is asked for. Armed, it aims from where they stand - an arc to
 * anywhere in range, gold where it can be made and red with an X where it cannot - and only a
 * landing past that range has a walk drawn in front of it.
 */

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setDiceSpeed(0));
}

/** Stamp blocks in the open field: one at (5, 5), and two stacked at (3, 10). */
async function buildBlocks(page: Page): Promise<void> {
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.getByTestId('mode-terrain').click();
  await page.evaluate(() => window.__engine!.setTerrain('block'));
  expect(await page.evaluate(() => window.__engine!.buildAt(5, 5))).toBe(true);
  expect(await page.evaluate(() => window.__engine!.buildAt(3, 10))).toBe(true);
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Raise build level', exact: true }).click();
  expect(await page.evaluate(() => window.__engine!.buildAt(3, 10))).toBe(true);
  await page.evaluate(() => window.__engine!.setMode('play'));
}

/** Aim at a spot with the mouse and wait for the board to say what it makes of it. */
async function aimAt(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const at = await page.evaluate((spot) => window.__engine!.screenAt(spot.x, spot.y), { x, y });
  await page.mouse.move(at.x, at.y - 8);
  await page.mouse.move(at.x, at.y, { steps: 3 });
  return at;
}

test('a click only ever walks, and the Jump button aims an arc from where they stand', async ({ page }) => {
  test.setTimeout(300_000);
  await boot(page);
  // The room is pieces: every cell of it a tile, drawn from a file.
  await expect.poll(() => page.evaluate(() => window.__engine!.pieceModels())).toBeGreaterThan(300);
  await buildBlocks(page);
  const block = 5 * 44 + 5;
  const stack = 10 * 44 + 3;

  // Nothing was told about the block but the placing of it: no walk goes up there.
  await page.evaluate(() => window.__engine!.select('kara'));
  expect(await page.evaluate(() => window.__engine!.reachable())).not.toContain(block);

  // A click on top of it is a walk to the foot of it. No roll, no jump.
  await page.evaluate(() => window.__engine!.walkTo(5, 5));
  expect(await page.evaluate(() => window.__engine!.pendingKind())).toBeNull();
  await expect.poll(() => page.evaluate(() => window.__engine!.gliding()), { timeout: 30_000 }).toBe(0);
  const foot = await page.evaluate(() => window.__engine!.tileOf('kara'));
  expect(foot).not.toBe(block);
  expect(await page.evaluate(() => window.__engine!.log().some((line) => line.text.includes('jumps')))).toBe(false);

  // The key, beside the Light, with Rest beside it: twins off one keyboard.
  const button = page.getByTestId('jump-button');
  await expect(button).toBeVisible();
  const orb = (await page.getByTestId('light-orb').boundingBox())!;
  const medal = (await button.boundingBox())!;
  expect(medal.x).toBeGreaterThanOrEqual(orb.x + orb.width - 20);
  expect(medal.x).toBeLessThan(orb.x + orb.width + 40);
  const rest = (await page.getByTestId('open-rest').boundingBox())!;
  expect(rest.x).toBeGreaterThan(medal.x + medal.width);
  expect(rest.x).toBeLessThan(medal.x + medal.width + 24);
  expect({ width: rest.width, height: rest.height, y: rest.y }).toEqual({ width: medal.width, height: medal.height, y: medal.y });
  await expect(button).toHaveClass(/key-btn/);

  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.__engine!.targeting())).toBe('jump:button');
  // A range is drawn as the shape it is now: a jump's reach is a gold ring round where they stand,
  // and no ground is lit as squares for it (`game/circle.ts`).
  expect(await page.evaluate(() => window.__engine!.lit())).toEqual([]);
  expect(block).toBe(5 * 44 + 5);
  expect(foot).not.toBe(block);
  await expect(page.getByText('Jump: click a spot on the board')).toBeVisible();
  expect(await button.locator('.jump-figure').evaluate((el) => getComputedStyle(el).animationName)).toBe('jump-leap');

  // Gold onto the block, from where she stands.
  expect(await page.evaluate(() => window.__engine!.arc())).toBeNull();
  const top = await aimAt(page, 5, 5);
  await expect.poll(() => page.evaluate(() => window.__engine!.arc())).toBe('ok');
  await page.screenshot({ path: 'test-results/jump-arc.png' });

  // A second press puts it down, and the arc with it.
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.__engine!.lit())).toEqual([]);
  expect(await page.evaluate(() => window.__engine!.arc())).toBeNull();

  // Armed again and clicked: the roll, and then the landing.
  await button.click();
  await page.mouse.click(top.x, top.y);
  expect(await page.evaluate(() => window.__engine!.pendingKind())).toBe('check');
  await page.evaluate(() => window.__engine!.answer({ kind: 'roll' }));
  await expect.poll(() => page.evaluate(() => window.__engine!.gliding()), { timeout: 30_000 }).toBe(0);
  expect(await page.evaluate(() => window.__engine!.tileOf('kara'))).toBe(block);
  await expect(button).toHaveAttribute('aria-pressed', 'false');

  // Mira, Strength -1, jumps one block. The stack of two is past her wherever she walks to: red, with an X.
  await page.evaluate(() => window.__engine!.select('mira'));
  await button.click();
  await aimAt(page, 3, 10);
  await expect.poll(() => page.evaluate(() => window.__engine!.arc())).toBe('blocked');
  await page.screenshot({ path: 'test-results/jump-arc-blocked.png' });
  const before = await page.evaluate(() => window.__engine!.tileOf('mira'));
  const stackAt = await page.evaluate(() => window.__engine!.screenAt(3, 10));
  await page.mouse.click(stackAt.x, stackAt.y);
  expect(await page.evaluate(() => window.__engine!.pendingKind())).toBeNull();
  expect(await page.evaluate(() => window.__engine!.tileOf('mira'))).toBe(before);
  expect(stack).toBe(10 * 44 + 3);
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});

test('a jump aimed past their range walks first, and one in range does not', async ({ page }) => {
  test.setTimeout(300_000);
  await boot(page);
  await page.evaluate(() => window.__engine!.select('kara'));
  const start = await page.evaluate(() => window.__engine!.tileOf('kara'));
  const button = page.getByTestId('jump-button');

  // In range, across level ground: no roll, nothing walked, and she is there.
  await button.click();
  const near = { x: (start % 44) + 3, y: Math.floor(start / 44) + 2 };
  const nearAt = await aimAt(page, near.x, near.y);
  await expect.poll(() => page.evaluate(() => window.__engine!.arc())).toBe('ok');
  await page.mouse.click(nearAt.x, nearAt.y);
  expect(await page.evaluate(() => window.__engine!.pendingKind())).toBeNull();
  await expect.poll(() => page.evaluate(() => window.__engine!.gliding()), { timeout: 30_000 }).toBe(0);
  const landed = await page.evaluate(() => window.__engine!.tileOf('kara'));
  expect(landed).toBe(near.y * 44 + near.x);
  expect(await page.evaluate(() => window.__engine!.log().at(-1)!.text)).toMatch(/^Kara jumps \d tiles?\.$/);

  // Past her five tiles: not lit, and still aimed at - the walk is drawn, then the arc.
  await button.click();
  const far = { x: 11, y: near.y };
  expect(await page.evaluate(() => window.__engine!.lit())).not.toContain(far.y * 44 + far.x);
  const farAt = await aimAt(page, far.x, far.y);
  await expect.poll(() => page.evaluate(() => window.__engine!.arc())).toBe('ok');
  await page.screenshot({ path: 'test-results/jump-run-up.png' });
  await page.mouse.click(farAt.x, farAt.y);
  await expect.poll(() => page.evaluate(() => window.__engine!.gliding()), { timeout: 40_000 }).toBe(0);
  expect(await page.evaluate(() => window.__engine!.tileOf('kara'))).toBe(far.y * 44 + far.x);
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});

test('the player keeps a setting in the browser to roll jumps without being asked', async ({ page }) => {
  test.setTimeout(300_000);
  await boot(page);
  await buildBlocks(page);
  await page.evaluate(() => window.__engine!.select('kara'));
  await page.evaluate(() => window.__engine!.walkTo(5, 5));
  await expect.poll(() => page.evaluate(() => window.__engine!.gliding()), { timeout: 30_000 }).toBe(0);

  // Off to begin with, and nothing kept. There is no button for the settings: Escape opens them.
  expect(await page.evaluate(() => localStorage.getItem('tactical-engine:user-settings'))).toBeNull();
  await expect(page.getByTestId('open-settings')).toHaveCount(0);
  const box = page.getByTestId('user-settings');
  await expect(box).toHaveCount(0);

  // Escape with something to put down is that thing's: the loadout shuts, a jump being aimed is called off.
  await page.getByTestId('open-loadout').click();
  await expect(page.getByTestId('loadout')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('loadout')).toHaveCount(0, { timeout: 15_000 });
  await expect(box).toHaveCount(0);
  await page.getByTestId('jump-button').click();
  await expect(page.getByTestId('cancel-targeting')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cancel-targeting')).toHaveCount(0);
  await expect(box).toHaveCount(0);

  // With nothing to put down, it is the settings: a sheet over the table, under headings.
  await page.keyboard.press('Escape');
  await expect(box).toBeVisible();
  await expect(box).toHaveAttribute('role', 'dialog');
  await expect(box.locator('[data-section="Dice"]')).toContainText('Roll jumps automatically');
  const auto = box.getByTestId('setting-autoRollJumps');
  await expect(auto).not.toBeChecked();
  await auto.check();
  // Drawn on, not only ticked: the track goes to ink once the switch has finished moving.
  await expect.poll(() => auto.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(74, 61, 46)');
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('tactical-engine:user-settings')))!)).toEqual({ autoRollJumps: true });
  await page.screenshot({ path: 'test-results/user-settings.png' });
  // The keys are the sheet's while it is up: Tab does not pass the selection round the party behind it.
  const selected = await page.evaluate(() => window.__engine!.selected());
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => window.__engine!.selected())).toBe(selected);
  // And Escape puts it away again.
  await page.keyboard.press('Escape');
  await expect(box).toHaveCount(0);

  // The jump up the block is rolled at once: no prompt, the dice shown, and she is up there.
  const button = page.getByTestId('jump-button');
  await button.click();
  const top = await aimAt(page, 5, 5);
  await expect.poll(() => page.evaluate(() => window.__engine!.arc())).toBe('ok');
  await page.mouse.click(top.x, top.y);
  expect(await page.evaluate(() => window.__engine!.pendingKind())).toBeNull();
  await expect.poll(() => page.evaluate(() => window.__engine!.gliding()), { timeout: 30_000 }).toBe(0);
  expect(await page.evaluate(() => window.__engine!.tileOf('kara'))).toBe(5 * 44 + 5);
  // The roll was made and read out, not skipped: the log has the dice against the Difficulty.
  expect(await page.evaluate(() => window.__engine!.log().some((line) => /= \d+ vs 12\./.test(line.text)))).toBe(true);

  // It is the browser's, not the page's: a reload still has it, and it can be turned off again.
  await page.reload();
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('setting-autoRollJumps')).toBeChecked();
  await page.getByTestId('setting-autoRollJumps').uncheck();
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('tactical-engine:user-settings')))!)).toEqual({ autoRollJumps: false });
  await page.getByTestId('close-settings').click();
  await expect(page.getByTestId('user-settings')).toHaveCount(0);
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});

test('a jump rolled by hand is not drawn until the roll has been accepted', async ({ page }) => {
  test.setTimeout(300_000);
  await boot(page);
  await buildBlocks(page);
  await page.evaluate(() => window.__engine!.select('kara'));
  await page.evaluate(() => window.__engine!.walkTo(5, 5));
  await expect.poll(() => page.evaluate(() => window.__engine!.gliding()), { timeout: 30_000 }).toBe(0);

  await page.getByTestId('jump-button').click();
  const top = await aimAt(page, 5, 5);
  await expect.poll(() => page.evaluate(() => window.__engine!.arc())).toBe('ok');
  await page.mouse.click(top.x, top.y);
  await expect(page.getByTestId('check-prompt')).toBeVisible();

  // Thrown on the card, and the card holds the result: the jump is decided, and nothing on the board has moved.
  await page.getByTestId('roll').click();
  await expect(page.getByTestId('accept')).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => window.__engine!.tileOf('kara'))).toBe(5 * 44 + 5);
  for (let i = 0; i < 4; i++) {
    expect(await page.evaluate(() => window.__engine!.gliding())).toBe(0);
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: 'test-results/jump-held.png' });

  // Accepted: now she jumps.
  await page.getByTestId('accept').click();
  await expect.poll(() => page.evaluate(() => window.__engine!.gliding()), { intervals: [50], timeout: 20_000 }).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__engine!.gliding()), { timeout: 40_000 }).toBe(0);
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});

/**
 * The rules are the project's. Changed in the Tiles workspace, they are what the next jump
 * plays by, they ride in the saved file, and they go back to the engine's own with one button.
 */
test('jump rules set in the editor are the rules the game plays by', async ({ page }) => {
  test.setTimeout(300_000);
  await boot(page);
  await buildBlocks(page);
  const button = page.getByTestId('jump-button');

  // Two blocks stacked in the open: past Mira, who is Strength -1 and jumps one.
  await page.evaluate(() => window.__engine!.select('mira'));
  await button.click();
  await aimAt(page, 3, 10);
  await expect.poll(() => page.evaluate(() => window.__engine!.arc())).toBe('blocked');
  await button.click();

  // Anybody jumps two, and the roll is Finesse against 9.
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.getByTestId('open-content').click();
  await page.getByTestId('open-tiles').click();
  await page.getByTestId('open-jump-rules').click();
  const rules = page.getByTestId('jump-rules');
  await expect(rules).toBeVisible();
  await expect(rules.getByTestId('jump-reach-readout')).toHaveText('Strength 0 jumps 1, +1 jumps 2, +2 jumps 3.');
  await expect(rules.getByTestId('jump-range-readout')).toContainText('Strength 0 carries 3 tiles, +1 carries 4, +2 carries 5.');
  await rules.getByTestId('jump-reachBase').fill('2');
  await rules.getByTestId('jump-reachBase').press('Tab');
  await rules.getByTestId('jump-rollTrait').selectOption('finesse');
  await rules.getByTestId('jump-difficulty').fill('9');
  await rules.getByTestId('jump-difficulty').press('Tab');
  await expect(rules.getByTestId('jump-reach-readout')).toHaveText('Strength 0 jumps 2, +1 jumps 3, +2 jumps 4.');
  await page.screenshot({ path: 'test-results/jump-rules-panel.png' });
  const saved = JSON.parse(await page.evaluate(() => window.__engine!.exportProject())) as { jump?: Record<string, unknown> };
  expect(saved.jump).toMatchObject({ reachBase: 2, rollTrait: 'finesse', difficulty: 9 });
  await page.getByTestId('close-tiles').click();

  await page.evaluate(() => window.__engine!.setMode('play'));
  await page.evaluate(() => window.__engine!.select('mira'));
  await button.click();
  const stackAt = await aimAt(page, 3, 10);
  await expect.poll(() => page.evaluate(() => window.__engine!.arc())).toBe('ok');
  await page.mouse.click(stackAt.x, stackAt.y);
  expect(await page.evaluate(() => window.__engine!.pendingKind())).toBe('check');
  await expect(page.getByText(/Jump up 2 blocks: a Finesse Roll/)).toBeVisible();
  await page.evaluate(() => window.__engine!.answer({ kind: 'roll' }));
  await expect.poll(() => page.evaluate(() => window.__engine!.gliding()), { timeout: 40_000 }).toBe(0);
  expect(await page.evaluate(() => window.__engine!.tileOf('mira'))).toBe(10 * 44 + 3);

  // And back to the engine's own, by saying nothing.
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.getByTestId('open-content').click();
  await page.getByTestId('open-tiles').click();
  await page.getByTestId('open-jump-rules').click();
  await page.getByTestId('jump-reset').click();
  expect((JSON.parse(await page.evaluate(() => window.__engine!.exportProject())) as { jump?: unknown }).jump).toBeUndefined();
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});
