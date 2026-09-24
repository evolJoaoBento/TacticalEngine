import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * The merchant in the default project, played: the camp's crate gives up a few coins, Tobin the
 * Pedlar is talked to rather than struck, "Show me your wares" opens his shop while the talk goes
 * on, buying pays from the party pack, and he buys back what he sells at his own stingy rate. Beside
 * him Wren the Wandering Bard gives the party a quest.
 *
 * Every other suite plays the demo built from code; this one is about what the project file holds,
 * so it serves `projects/default.json` itself, as `default-project.spec.ts` does - less any model an
 * author embedded in it, which is not what this is about.
 */

const shipped = ((project: { assets?: { url: string }[] }) =>
  JSON.stringify({ ...project, assets: (project.assets ?? []).filter((asset) => !asset.url.startsWith('data:')) }))(
  JSON.parse(readFileSync('projects/default.json', 'utf8')),
);

test('the merchant by the camp fire sells to a party that can pay', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/projects/default.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: shipped }));
  await page.goto('/?boot=file');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setDiceSpeed(0));

  // Down the trail to the camp, and the coin in its crate.
  const taken = await page.evaluate(() => {
    const api = window.__engine!;
    api.approach('crate-prop-3-24');
    api.arrive();
    let coins = 0;
    while (api.container()?.lines.some((line) => line.item === 'gold') === true && coins < 30) {
      api.take('gold');
      coins++;
    }
    return coins;
  });
  expect(taken).toBe(20);

  // Tobin is talked to, not struck.
  await page.evaluate(() => window.__engine!.attack('tobin'));
  expect(await page.evaluate(() => window.__engine!.hasDialogue())).toBe(true);
  expect(await page.evaluate(() => window.__engine!.hitPoints('tobin').marked)).toBe(0);
  await page.evaluate(() => {
    const api = window.__engine!;
    api.answer({ kind: 'choose', index: api.dialogueOptions().indexOf('Show me your wares.') });
  });

  // His shop opens in the middle of the screen, over everything, and says what the party can spend.
  const shop = page.getByTestId('container');
  await expect(shop).toHaveAttribute('data-container', 'tobin');
  await expect(page.getByTestId('shop-backdrop')).toBeVisible();
  const box = (await shop.boundingBox())!;
  const screen = page.viewportSize()!;
  expect(Math.abs(box.x + box.width / 2 - screen.width / 2)).toBeLessThan(4);
  expect(Math.abs(box.y + box.height / 2 - screen.height / 2)).toBeLessThan(4);
  await expect(shop).toContainText('Tobin the Pedlar');
  await expect(shop.getByTestId('shop-purse')).toHaveText('You have 20 gold.');
  const draught = shop.locator('[data-item="healing-draught"]').getByTestId('shop-buy');
  await expect(draught).toContainText('6 gold');
  await page.screenshot({ path: 'test-results/merchant-shop.png' });
  await draught.click();
  await expect(shop.getByTestId('shop-purse')).toHaveText('You have 14 gold.');
  // What costs more than is left cannot be bought.
  await expect(shop.locator('[data-item="hunting-bow"]').getByTestId('shop-buy')).toBeDisabled();
  expect(await page.evaluate(() => window.__engine!.log().some((line) => /buys Healing Draught for 6 gold/i.test(line.text)))).toBe(true);

  // The pack says what the draught is worth, before anybody offers for it.
  await expect(page.getByTestId('pack').locator('[data-item="healing-draught"]').getByTestId('item-worth')).toHaveText('worth 6');
  await expect(page.getByTestId('pack').locator('[data-item="gold"]').getByTestId('item-worth')).toHaveCount(0);
  await page.getByTestId('pack').screenshot({ path: 'test-results/pack-worth.png' });

  // And he buys it back - at his own stingy rate, four in ten of what he asked.
  const sell = shop.getByTestId('shop-selling').locator('[data-sell="healing-draught"]').getByTestId('shop-sell');
  await expect(sell).toContainText('2 gold');
  await sell.click();
  await expect(shop.getByTestId('shop-purse')).toHaveText('You have 16 gold.');
  await expect(shop.getByTestId('shop-selling')).toHaveCount(0);

  // The conversation waits for the shop: its replies are shut, and an answer is not taken.
  await expect(page.getByTestId('dialogue-held')).toHaveText('Close the shop to go on.');
  for (const reply of await page.getByTestId('dialogue').getByRole('button').all()) await expect(reply).toBeDisabled();
  expect(await page.evaluate(() => {
    const api = window.__engine!;
    api.answer({ kind: 'continue' });
    return api.pendingKind();
  })).not.toBeNull();

  // The loadout still opens, over the shop, and shuts back to it.
  await page.getByTestId('open-loadout').click();
  await expect(page.getByTestId('loadout-backdrop')).toBeVisible();
  await page.getByTestId('close-loadout').click();
  await expect(page.getByTestId('loadout-backdrop')).toHaveCount(0);
  await expect(shop).toBeVisible();

  // Esc does not close it: it opens the settings, over the shop, and shuts them again.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-backdrop')).toBeVisible();
  await expect(shop).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-backdrop')).toHaveCount(0);
  await expect(shop).toBeVisible();

  // A click outside the window closes it, and the conversation goes on - and ends as any other does.
  await page.getByTestId('shop-backdrop').click({ position: { x: 8, y: 8 } });
  await expect(page.getByTestId('shop-backdrop')).toHaveCount(0);
  await expect(page.getByTestId('dialogue-held')).toHaveCount(0);
  await page.evaluate(() => {
    const api = window.__engine!;
    for (let i = 0; i < 10 && api.pendingKind() !== null; i++) {
      const options = api.dialogueOptions();
      api.answer(options.length > 0 ? { kind: 'choose', index: options.length - 1 } : { kind: 'continue' });
    }
  });
  expect(await page.evaluate(() => window.__engine!.pendingKind())).toBeNull();
  expect(errors).toEqual([]);
});

test('Wren the Wandering Bard by the same fire gives the party a quest', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/projects/default.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: shipped }));
  await page.goto('/?boot=file');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setDiceSpeed(0));

  // Talked to, not struck; the question about her trouble is there until it is asked.
  await page.evaluate(() => window.__engine!.attack('wren'));
  expect(await page.evaluate(() => window.__engine!.dialogueOptions())).toContain('Is something wrong?');
  // A reply is clicked as a player clicks it: its button, by what it says. (The driver's index is a
  // reply's place among all a node's replies, hidden ones included, not among those on screen.)
  const dialogue = page.getByTestId('dialogue');
  const pick = async (text: string): Promise<void> => {
    await dialogue.getByRole('button', { name: text, exact: true }).click();
    await page.evaluate(() => {
      const api = window.__engine!;
      for (let i = 0; i < 5 && api.pendingKind() !== null && api.dialogueOptions().length === 0; i++) api.answer({ kind: 'continue' });
    });
  };
  await pick('Is something wrong?');
  await pick('We will find it.');
  // The consequence started her quest, and the journal says what to do.
  const journal = page.getByTestId('journal');
  await expect(journal).toContainText('The Lost Verse');
  await expect(journal).toContainText("Find Wren's songbook in the vault.");
  await page.screenshot({ path: 'test-results/bard-quest.png' });
  await pick('Farewell.');
  await page.evaluate(() => {
    const api = window.__engine!;
    for (let i = 0; i < 5 && api.pendingKind() !== null; i++) api.answer({ kind: 'continue' });
  });
  expect(await page.evaluate(() => window.__engine!.pendingKind())).toBeNull();
  expect(errors).toEqual([]);
});

test('a conversation takes the cards place and holds the camera on whoever is talked to', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1400, height: 850 });
  await page.route('**/projects/default.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: shipped }));
  await page.goto('/?boot=file');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setDiceSpeed(0));
  const bar = page.getByTestId('action-bar');
  const before = await page.evaluate(() => window.__engine!.camera());
  await expect(bar.getByTestId('attack-chip')).toBeVisible();

  await page.evaluate(() => window.__engine!.attack('wren'));
  // Along the bottom, where the cards were: the keys and the cards step aside; the Light, the
  // Shadow, the round and the Loadout stay.
  await expect(bar.getByTestId('dialogue')).toBeVisible();
  await expect(bar.getByTestId('attack-chip')).toHaveCount(0);
  await expect(bar.getByTestId('jump-button')).toHaveCount(0);
  await expect(bar.getByTestId('open-rest')).toHaveCount(0);
  await expect(bar.getByTestId('light-orb')).toBeVisible();
  await expect(bar.getByTestId('shadow-die')).toBeVisible();
  await expect(bar.getByTestId('open-loadout')).toBeVisible();
  // And not twice: the play panel on the right no longer has one of its own.
  await expect(page.getByTestId('dialogue')).toHaveCount(1);

  // The camera is on her, drawn in, and stays there under the wheel and a pan; turning still turns.
  const held = await page.evaluate(() => ({ camera: window.__engine!.camera(), wren: window.__engine!.standingAt('wren') }));
  expect(held.camera.distance).toBeLessThan(before.distance);
  await page.mouse.move(700, 400);
  await page.mouse.wheel(0, 600);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(900, 300, { steps: 6 });
  await page.mouse.up({ button: 'right' });
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(600, 400, { steps: 6 });
  await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => window.__engine!.camera());
  expect(after.distance).toBeCloseTo(held.camera.distance, 5);
  expect(after.target).toEqual(held.camera.target);
  expect(after.yaw).not.toBeCloseTo(held.camera.yaw, 3);
  await page.screenshot({ path: 'test-results/conversation-bar.png' });

  // Over, the cards come back and the camera goes back to where it was looking from.
  await bar.getByTestId('dialogue').getByRole('button', { name: 'Farewell.', exact: true }).click();
  await page.evaluate(() => {
    const api = window.__engine!;
    for (let i = 0; i < 5 && api.pendingKind() !== null; i++) api.answer({ kind: 'continue' });
  });
  await expect(bar.getByTestId('attack-chip')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__engine!.camera().distance)).toBeCloseTo(before.distance, 3);
  expect(errors).toEqual([]);
});

test('talking to somebody across the camp waits for the walk, and a right-click on the way calls it off', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1400, height: 850 });
  await page.route('**/projects/default.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: shipped }));
  /** How far each of the party stands from him. */
  const fromTobin = (): Promise<number[]> => page.evaluate(() => {
    const api = window.__engine!;
    const him = api.standingAt('tobin')!;
    return api.party().map((id) => { const at = api.standingAt(id)!; return Math.hypot(at.x - him.x, at.y - him.y); });
  });
  let before: number[] = [];
  const clickTobin = async (): Promise<void> => {
    await page.goto('/?boot=file');
    await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
    await page.evaluate(() => window.__engine!.setDiceSpeed(0));
    before = await fromTobin();
    const at = await page.evaluate(() => {
      const spot = window.__engine!.standingAt('tobin')!;
      return window.__engine!.screenAt(spot.x, spot.y);
    });
    await page.mouse.click(at.x, at.y);
  };

  // A click on him walks the party down the trail; nothing is said until they are there.
  await clickTobin();
  await expect(page.getByTestId('dialogue')).toHaveCount(0);
  expect(await page.evaluate(() => window.__engine!.gliding())).toBeGreaterThan(0);
  await expect(page.getByTestId('dialogue')).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => window.__engine!.gliding())).toBe(0);
  await expect(page.getByTestId('dialogue')).toContainText('Travellers! Sit by the fire');
  // The rest of the party walked down with them, most of the way from wherever they stood.
  await page.screenshot({ path: 'test-results/talk-party-follows.png' });
  const after = await fromTobin();
  expect(before.length).toBeGreaterThan(1);
  after.forEach((distance, i) => expect(distance).toBeLessThan(before[i]! / 2));

  // The same click, and a right-click on the way: they stop where they got to, and he says nothing.
  await clickTobin();
  await page.waitForTimeout(300);
  await page.mouse.click(1250, 150, { button: 'right' });
  await expect.poll(() => page.evaluate(() => window.__engine!.gliding()), { timeout: 30_000 }).toBe(0);
  await page.waitForTimeout(500);
  await expect(page.getByTestId('dialogue')).toHaveCount(0);
  expect(await page.evaluate(() => window.__engine!.pendingKind())).toBeNull();
  // Stopped short: not beside him.
  const apart = await page.evaluate(() => {
    const api = window.__engine!;
    const me = api.standingAt(api.selected()!)!;
    const him = api.standingAt('tobin')!;
    return Math.hypot(me.x - him.x, me.y - him.y);
  });
  expect(apart).toBeGreaterThan(2);
  expect(errors).toEqual([]);
});

test('Tab leaves a conversation with whoever is having it, held there while the rest go on', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/projects/default.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: shipped }));
  await page.goto('/?boot=file');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setDiceSpeed(0));
  const dialogue = page.getByTestId('dialogue');

  const talker = await page.evaluate(() => {
    const api = window.__engine!;
    api.attack('tobin');
    return api.selected()!;
  });
  await expect(dialogue).toContainText('Travellers! Sit by the fire');
  // Esc opens the settings in a conversation too, and shuts them.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-backdrop')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-backdrop')).toHaveCount(0);

  // Tab: somebody else, the cards back, and the one talking marked on their card.
  await page.keyboard.press('Tab');
  await expect(dialogue).toHaveCount(0);
  expect(await page.evaluate(() => window.__engine!.selected())).not.toBe(talker);
  expect(await page.evaluate(() => window.__engine!.pendingKind())).toBeNull();
  await expect(page.getByTestId('hud-talking')).toHaveCount(1);
  await expect(page.getByTestId('action-bar').locator('.hand')).toBeVisible();
  await page.screenshot({ path: 'test-results/talk-set-aside.png' });

  // The rest walk off; the one talking stays where they are.
  const walked = await page.evaluate((who) => {
    const api = window.__engine!;
    const stood = api.tileOf(who);
    const other = api.selected()!;
    const from = api.tileOf(other);
    const tiles = api.reachable().filter((tile) => tile !== from);
    api.moveTo(tiles[Math.floor(tiles.length / 2)]!);
    api.arrive();
    return { stood, now: api.tileOf(who), moved: api.tileOf(other) !== from };
  }, talker);
  expect(walked.moved).toBe(true);
  expect(walked.now).toBe(walked.stood);

  // Back to them, and the conversation is where it was; ended, they are free.
  await page.evaluate((who) => window.__engine!.select(who), talker);
  await expect(dialogue).toContainText('Travellers! Sit by the fire');
  await expect(page.getByTestId('hud-talking')).toHaveCount(0);
  await dialogue.getByRole('button', { name: 'Nothing today.', exact: true }).click();
  await page.evaluate(() => {
    const api = window.__engine!;
    for (let i = 0; i < 5 && api.pendingKind() !== null; i++) api.answer({ kind: 'continue' });
  });
  expect(await page.evaluate(() => window.__engine!.pendingKind())).toBeNull();
  await expect(dialogue).toHaveCount(0);
  expect(errors).toEqual([]);
});
