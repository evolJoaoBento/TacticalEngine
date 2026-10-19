import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The Ashwell (`docs/ASHWELL.md`), Level 1 played through from the main menu: the Lantern & Lye, Mother Ketch, the
 * well; the Throat, Vane's page, the Wellrats and their takings; the Warden, his strongbox, the Sump Gate and the stair
 * down - and back up to Ketch, the quest done. The fights are begun by walking into them, and settled by the driver's
 * wounds rather than played out: what is tested is the level, not the rules, which have suites of their own.
 */

/** Every prompt waiting answered with its first choice: a page read, a roll let pass. */
async function drain(page: Page): Promise<void> {
  await page.evaluate(() => {
    const a = window.__engine!;
    for (let n = 0; n < 20 && a.pendingKind() !== null; n++) a.answer({ kind: 'choose', index: 0 });
  });
}

/**
 * A fight begun by walking onto the cell that wakes it, and won: every adversary in it wounded to a blow from down by
 * the driver, then struck by whoever can reach, the room taking its turns between. Real blows, so the fight ends as one
 * does, and whatever waits on its end sees it end.
 */
async function fight(page: Page, at: { x: number; y: number }): Promise<void> {
  await page.evaluate(({ x, y }) => {
    const a = window.__engine!;
    a.walkTo(x + 0.5, y + 0.5);
    a.arrive();
  }, at);
  await expect.poll(() => page.evaluate(() => window.__engine!.inCombat()), { timeout: 15_000 }).toBe(true);
  await win(page);
}

/** The fight going on, won: every adversary wounded to a blow from down, then struck by whoever can reach. */
async function win(page: Page): Promise<void> {
  for (let round = 0; round < 40 && (await page.evaluate(() => window.__engine!.inCombat())); round++) {
    await page.evaluate(() => {
      const a = window.__engine!;
      for (const foe of a.adversaries()) a.wound(foe, a.hitPoints(foe).max - 1);
      for (const member of a.party()) {
        const foe = a.adversaries()[0];
        if (foe === undefined) break;
        a.select(member);
        a.attack(foe);
        for (let n = 0; n < 20 && a.pendingKind() !== null; n++) a.answer({ kind: 'choose', index: 0 });
      }
    });
    await drain(page);
    if (await page.evaluate(() => window.__engine!.inCombat())) {
      await page.evaluate(() => window.__engine!.endGmTurn());
      await drain(page);
    }
  }
  await expect.poll(() => page.evaluate(() => window.__engine!.inCombat()), { timeout: 15_000 }).toBe(false);
}

/** A thing walked up to and used, every prompt it raised answered: what using it said. */
async function use(page: Page, id: string): Promise<string> {
  const said = await page.evaluate((thing) => window.__engine!.approach(thing), id);
  await page.evaluate(() => window.__engine!.arrive());
  return said;
}

const questOf = (page: Page, id: string) => page.evaluate((wanted) => window.__engine!.journal().find((q) => q.id === wanted) ?? null, id);
const quest = (page: Page) => questOf(page, 'down-the-ashwell');
const market = (page: Page) => questOf(page, 'the-ossuary-market');
const scene = (page: Page) => page.evaluate(() => window.__engine!.sceneId());

/**
 * A choice in the conversation open, by its words, clicked as a player clicks it: the panel's button answers with the
 * choice's place among all the node's choices, the ones not offered too, which the words alone do not say.
 */
async function choose(page: Page, text: string): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__engine!.dialogueOptions())).toContain(text);
  await page.getByTestId('dialogue').locator('.panel-option', { hasText: text }).first().click();
}

/** A creature spoken to: walked up to, and the conversation it opens. */
async function talkTo(page: Page, id: string): Promise<void> {
  await page.evaluate((who) => {
    const a = window.__engine!;
    a.attack(who);
    a.arrive();
  }, id);
  await expect.poll(() => page.evaluate(() => window.__engine!.hasDialogue())).toBe(true);
}
const lastLine = (page: Page) => page.evaluate(() => window.__engine!.log().at(-1)?.text ?? '');

/** Level 1, from the menu to the Market: Ketch heard, the Throat cleared, the gate opened and the stair taken. */
async function levelOne(page: Page): Promise<void> {
  await page.goto('/?menu');
  await page.getByTestId('menu-load').click();
  await page.getByTestId('menu-play-ashwell').click();
  await expect(page).toHaveURL(/[?&]play&project=the-ashwell$/);
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5, null, { timeout: 60_000 });
  await page.evaluate(() => window.__engine!.setDiceSpeed(0));

  // The Lantern & Lye. The well will not take anybody who has not heard Ketch out.
  expect(await page.evaluate(() => window.__engine!.sceneId())).toBe('lantern-and-lye');
  await page.screenshot({ path: 'test-results/ashwell-hub.png' });
  await use(page, 'the-well');
  await drain(page);
  expect(await page.evaluate(() => window.__engine!.sceneId())).toBe('lantern-and-lye');
  expect(await lastLine(page)).toContain('Not on my rope');

  // Mother Ketch: the slate, and the names on it.
  await use(page, 'mother-ketch');
  await expect.poll(() => page.evaluate(() => window.__engine!.dialogueOptions())).toContain('We are going down.');
  expect(await page.evaluate(() => window.__engine!.dialogueOptions())).not.toContain('We came back up. There is a stair, past the Sump, and it goes on.');
  await page.evaluate(() => window.__engine!.answer({ kind: 'choose', index: 2 }));
  await expect.poll(() => page.evaluate(() => window.__engine!.dialogueOptions())).toEqual(['[Go to the well.]']);
  await page.evaluate(() => window.__engine!.answer({ kind: 'choose', index: 0 }));
  await drain(page);
  expect(await quest(page)).toMatchObject({ status: 'active', done: [] });
  expect((await page.evaluate(() => window.__engine!.carried())).find((c) => c.id === 'consumable-minor-health-potion')?.quantity).toBeGreaterThanOrEqual(2);

  // Down the rope.
  await use(page, 'the-well');
  await drain(page);
  await expect.poll(() => page.evaluate(() => window.__engine!.sceneId())).toBe('the-throat');
  expect((await quest(page))?.done).toEqual(['go-down']);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/ashwell-throat.png' });

  // Vane's page, nailed up.
  await use(page, 'first-page');
  await drain(page);
  expect(await lastLine(page)).toMatch(/^Entry 4,112 "They came down in good order\./);

  // The Wellrats: their takings are not to be had while they stand; after, they are.
  await use(page, 'wellrat-takings');
  await drain(page);
  expect(await lastLine(page)).toBe('Not with the Wellrats watching you do it.');
  await fight(page, { x: 22, y: 4 });
  await use(page, 'wellrat-takings');
  await drain(page);
  expect((await quest(page))?.done).toContain('break-the-wellrats');

  // Down the passage from the camp to the Sump, where the Warden has the gate's key.
  await use(page, 'down-to-the-sump');
  await drain(page);
  await expect.poll(() => page.evaluate(() => window.__engine!.sceneId())).toBe('the-sump');
  await fight(page, { x: 7, y: 3 });
  await use(page, 'sump-gate');
  await drain(page);
  expect(await page.evaluate(() => window.__engine!.objectState('sump-gate').removed)).toBe(false);
  await use(page, 'wardens-strongbox');
  await drain(page);
  expect((await quest(page))?.done).toContain('the-warden');
  await use(page, 'sump-gate');
  await drain(page);
  expect(await page.evaluate(() => window.__engine!.objectState('sump-gate').removed)).toBe(true);
  await page.screenshot({ path: 'test-results/ashwell-sump.png' });

  // The stair down: Vane's second page, a level, the Level done - and through the bone door into the Market.
  await use(page, 'stair-down');
  await drain(page);
  expect((await page.evaluate(() => window.__engine!.log().map((line) => line.text))).some((text) => text.startsWith('Entry 4,113'))).toBe(true);
  await expect.poll(() => scene(page)).toBe('ossuary-market');
  expect(await quest(page)).toMatchObject({ status: 'completed' });
  expect(await market(page)).toMatchObject({ status: 'active', done: ['reach-the-market'] });
}

/** Level 2 as far as the Broker: Grale's errand, the Charnel Pit's fight and its bell-rope, the mark and the Guild's door. */
async function toTheBroker(page: Page): Promise<void> {
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/ashwell-market.png' });
  // The Guild's door is shut to the unmarked.
  await use(page, 'guild-door');
  await drain(page);
  expect(await page.evaluate(() => window.__engine!.objectState('guild-door').removed)).toBe(false);
  await use(page, 'usher-grale');
  await choose(page, 'We want to go further down.');
  await choose(page, '[Go to the pit.]');
  await drain(page);
  expect((await market(page))?.done).toContain('speak-to-the-guild');
  // The Charnel Pit: the rope is out of reach while the dead stand.
  await use(page, 'down-to-the-pit');
  await drain(page);
  await expect.poll(() => scene(page)).toBe('charnel-pit');
  await fight(page, { x: 7, y: 3 });
  await use(page, 'bell-rope');
  await drain(page);
  expect((await market(page))?.done).toContain('clear-the-pit');
  await use(page, 'up-from-the-pit');
  await drain(page);
  await expect.poll(() => scene(page)).toBe('ossuary-market');
  // Marked, and through.
  await use(page, 'usher-grale');
  await choose(page, 'The rope is cut. The bell will not ring again.');
  await choose(page, '[Go to the door.]');
  await drain(page);
  await use(page, 'guild-door');
  await drain(page);
  expect(await page.evaluate(() => window.__engine!.objectState('guild-door').removed)).toBe(true);
  await use(page, 'down-to-the-counting-house');
  await drain(page);
  await expect.poll(() => scene(page)).toBe('counting-house');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/ashwell-counting-house.png' });
}

/** The Bone Door opened with the Broker's key, and the wet stair taken: the Level done, and the climb back to the Lantern. */
async function downTheWetStair(page: Page): Promise<void> {
  await use(page, 'bone-door');
  await drain(page);
  expect(await page.evaluate(() => window.__engine!.objectState('bone-door').removed)).toBe(true);
  await use(page, 'library-stair');
  await drain(page);
  expect((await page.evaluate(() => window.__engine!.log().map((line) => line.text))).some((text) => text.startsWith('Entry 4,120'))).toBe(true);
  await expect.poll(() => scene(page)).toBe('lantern-and-lye');
  expect(await market(page)).toMatchObject({ status: 'completed' });
}

test('the Ashwell, Level 1: begun from the menu, Ketch heard, the Throat cleared, the gate opened and the stair taken into the Market', async ({ page }) => {
  test.setTimeout(240_000);
  await levelOne(page);
  // The bone stair climbs back to the Sump, and the Sump's stair comes straight down again, the page read once.
  await use(page, 'bone-stair-up');
  await drain(page);
  await expect.poll(() => scene(page)).toBe('the-sump');
  const pages = await page.evaluate(() => window.__engine!.log().filter((line) => line.text.startsWith('Entry 4,113')).length);
  await use(page, 'stair-down');
  await drain(page);
  await expect.poll(() => scene(page)).toBe('ossuary-market');
  expect(await page.evaluate(() => window.__engine!.log().filter((line) => line.text.startsWith('Entry 4,113')).length)).toBe(pages);
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});

test('the Ashwell, Level 2 paid for: the errand in the pit, the Guild\u2019s mark, a name of the party\u2019s own for the key, and back to Ketch', async ({ page }) => {
  test.setTimeout(300_000);
  await levelOne(page);
  await toTheBroker(page);
  // The Broker's box is not to be touched by a customer.
  await use(page, 'brokers-ledger-box');
  await drain(page);
  expect(await lastLine(page)).toBe('A Guild clerk looks at your hand on the box until you take it off.');
  const before = await page.evaluate(() => window.__engine!.party().map((id) => window.__engine!.stressOf(id).marked));
  await talkTo(page, 'sela-marrow');
  await choose(page, 'Take one of ours.');
  await choose(page, '[Take the key.]');
  await drain(page);
  expect(await page.evaluate(() => window.__engine!.inCombat())).toBe(false);
  expect((await market(page))?.done).toContain('the-broker');
  // It cost them: every one of them is the worse for it.
  const after = await page.evaluate(() => window.__engine!.party().map((id) => window.__engine!.stressOf(id).marked));
  after.forEach((marked, i) => expect(marked).toBeGreaterThan(before[i]!));
  await downTheWetStair(page);
  // Ketch, after the Market - her own name still hers.
  await use(page, 'mother-ketch');
  await choose(page, 'We have been to the Market under the Sump.');
  await expect.poll(() => page.evaluate(() => window.__engine!.dialogueOptions())).toEqual(['[Sit down by the fire.]']);
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});

test('the Ashwell, Level 2 fought for: the Broker refused, she and hers turned on the party, and her ledger-box opened over them', async ({ page }) => {
  test.setTimeout(300_000);
  await levelOne(page);
  await toTheBroker(page);
  await talkTo(page, 'sela-marrow');
  await choose(page, 'We will take the key instead.');
  await choose(page, '[Draw steel.]');
  await drain(page);
  // Her answer is the fight: all four of hers, at once.
  await expect.poll(() => page.evaluate(() => window.__engine!.inCombat()), { timeout: 15_000 }).toBe(true);
  expect((await page.evaluate(() => window.__engine!.adversaries())).sort()).toEqual(['guild-bonecutter-1', 'guild-bonecutter-2', 'guild-tallyman', 'sela-marrow']);
  await win(page);
  await use(page, 'brokers-ledger-box');
  await drain(page);
  expect((await market(page))?.done).toContain('the-broker');
  await downTheWetStair(page);
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});
