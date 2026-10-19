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

const quest = (page: Page) => page.evaluate(() => window.__engine!.journal().find((q) => q.id === 'down-the-ashwell') ?? null);
const lastLine = (page: Page) => page.evaluate(() => window.__engine!.log().at(-1)?.text ?? '');

test('the Ashwell, Level 1: begun from the menu, Ketch heard, the Throat cleared, the gate opened and the stair taken', async ({ page }) => {
  test.setTimeout(240_000);
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

  // The stair down: Vane's second page, a level, and the climb back up to the Lantern.
  await use(page, 'stair-down');
  await drain(page);
  expect((await page.evaluate(() => window.__engine!.log().map((line) => line.text))).some((text) => text.startsWith('Entry 4,113'))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__engine!.sceneId())).toBe('lantern-and-lye');
  expect(await quest(page)).toMatchObject({ status: 'completed' });

  // Ketch, after.
  await use(page, 'mother-ketch');
  await expect.poll(() => page.evaluate(() => window.__engine!.dialogueOptions())).toContain('We came back up. There is a stair, past the Sump, and it goes on.');
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});
