import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The Ashwell (`docs/ASHWELL.md`), begun as a player begins it - at a camp, three of the company asked along, through
 * the portal - and Level 1 played through: the Lantern & Lye, Mother Ketch, the
 * well; the Throat, Vane's page, the Wellrats and their takings; the Warden, his strongbox, the Sump Gate and the stair
 * down - and back up to Ketch, the quest done. The fights are begun by walking into them, and settled by the driver's
 * wounds rather than played out: what is tested is the level, not the rules, which have suites of their own.
 */

/**
 * Poly Haven, played by the test's own stone: every texture the Ashwell links answered from the fixture the material
 * import is tested with, under Poly Haven's names - never the real site, which a suite should not depend on.
 */
const STONE = unzipSync(readFileSync(resolve('tests/fixtures/tile-surface/TestStone_1K-PNG.zip')));
const MAPS = { Diffuse: ['diff', 'Color'], nor_gl: ['nor_gl', 'NormalGL'], Rough: ['rough', 'Roughness'], AO: ['ao', 'AmbientOcclusion'], Displacement: ['disp', 'Displacement'] } as const;
const DL = 'https://dl.polyhaven.org/file/ph-assets/Textures/png/1k';

test.beforeEach(async ({ page }) => {
  await page.route('https://api.polyhaven.com/**', (route) => {
    const [, ask, id] = /\/(info|files)\/([a-z0-9_]+)$/.exec(route.request().url()) ?? [];
    if (ask === 'info') return route.fulfill({ json: { name: id, dimensions: [2000, 2000] } });
    if (ask === 'files') return route.fulfill({ json: Object.fromEntries(Object.entries(MAPS).map(([map, [name]]) => [map, { '1k': { png: { url: `${DL}/${id}/${id}_${name}_1k.png` } } }])) });
    return route.fulfill({ status: 404, body: 'No asset' });
  });
  await page.route('https://dl.polyhaven.org/**', (route) => {
    const url = route.request().url();
    const [, file] = Object.values(MAPS).find(([name]) => url.endsWith(`_${name}_1k.png`)) ?? [];
    const bytes = file === undefined ? undefined : STONE[`TestStone_1K-PNG_${file}.png`];
    return bytes === undefined ? route.fulfill({ status: 404 }) : route.fulfill({ body: Buffer.from(bytes), contentType: 'image/png' });
  });
});

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
  // Rested first, as a party between fights would: ten fights end to end, with nobody resting, wear any four down.
  await page.evaluate(() => {
    const a = window.__engine!;
    for (const member of a.party()) {
      a.wound(member, 0);
      a.markStress(member, 0);
    }
  });
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
      // The party held up by the same hand: the levels the Ashwell grants are never taken here (the level-up panel
      // has its own tests), so a level-1 company is fighting tier-2 creatures, and what is tested is the level.
      for (const member of a.party()) a.wound(member, 0);
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
  // Won, not lost: every adversary down, and the party standing.
  expect(await page.evaluate(() => window.__engine!.adversaries())).toEqual([]);
  expect(await page.evaluate(() => window.__engine!.log().map((line) => line.text))).not.toContain('The party falls.');
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
const library = (page: Page) => questOf(page, 'the-drowned-library');
const furnace = (page: Page) => questOf(page, 'the-furnace-of-names');
const throne = (page: Page) => questOf(page, 'the-ledger-throne');
const logged = (page: Page) => page.evaluate(() => window.__engine!.log().map((line) => line.text));
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

/**
 * A camp made for Wren, a ranger, with the two cards New Game would have dealt her: this build's own, kept in step by
 * `adventure-portal.test.ts` - Playwright cannot import the game's modules to make one.
 */
const CAMP = readFileSync(resolve('tests/fixtures/camp-wren.json'), 'utf8');

/**
 * The Ashwell begun at a camp: Wren's, Quim, Scarlet and Arty asked along - Violet stays away, Wren having her model -
 * and the portal used, the Ashwell chosen. The game it opens is the party's own, and they go down as they were made.
 */
async function begin(page: Page): Promise<void> {
  // The menu first, as a player comes: it is what tells the page who is signed in, whose games the Ashwell is kept among.
  await page.goto('/?menu');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5, null, { timeout: 60_000 });
  expect(await page.evaluate((text) => window.__engine!.loadProjectText(text), CAMP)).toBe('');
  await page.waitForFunction(() => window.__engine?.sceneId() === 'camp', null, { timeout: 60_000 });
  for (const model of ['quim', 'scarlet', 'arty']) {
    await page.evaluate((figure) => {
      const a = window.__engine!;
      a.approach(figure);
      a.arrive();
    }, `${model}-figure`);
    await expect.poll(() => page.evaluate(() => window.__engine!.dialogueOptions())).toContain('Come with us.');
    await page.evaluate(() => window.__engine!.answer({ kind: 'choose', index: 0 }));
    await expect.poll(() => page.evaluate(() => window.__engine!.hasDialogue())).toBe(false);
  }
  expect(await page.evaluate(() => window.__engine!.party())).toEqual(['wren', 'quim', 'scarlet', 'arty']);
  await page.screenshot({ path: 'test-results/ashwell-camp.png' });
  await use(page, 'adventure-portal');
  const portal = page.getByTestId('container');
  await expect(portal).toHaveAttribute('data-container', 'adventure-portal');
  await expect(portal.locator('[data-adventure]')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/ashwell-portal.png' });
  await portal.locator('[data-adventure="the-ashwell"] [data-testid="adventure-begin"]').click();
  await expect(page).toHaveURL(/[?&]play&project=the-ashwell-[a-z0-9]+$/);
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5, null, { timeout: 60_000 });
  await page.evaluate(() => window.__engine!.setDiceSpeed(0));
  // The party that went through, as they were made: Wren with the cards she was dealt, her name on her card.
  expect(await page.evaluate(() => window.__engine!.party())).toEqual(['wren', 'quim', 'scarlet', 'arty']);
  expect((await page.evaluate(() => window.__engine!.loadout('wren'))).loadout).toEqual(expect.arrayContaining(['gifted-tracker', 'natures-tongue']));
  await expect(page.locator('.hud-card[data-member="wren"]')).toContainText('Wren');
}

/** Level 1, from the camp to the Market: Ketch heard, the Throat cleared, the gate opened and the stair taken. */
async function levelOne(page: Page): Promise<void> {
  await begin(page);

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
  // Its walls and floors in their linked materials: fetched the first time, packed, compressed for the GPU.
  await expect.poll(() => page.evaluate(() => window.__engine!.buildingStats().looks), { timeout: 60_000 }).toEqual(expect.arrayContaining(['castle-brick-07', 'cobblestone-floor-04']));
  await expect.poll(() => page.evaluate(() => window.__engine!.buildingStats().textured), { timeout: 60_000 }).toBeGreaterThan(0);
  const drawn = await page.evaluate(() => window.__engine!.buildingStats());
  expect(drawn.compressed).toBe(drawn.textured);
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

/** The Bone Door opened with the Broker's key, and the wet stair taken: Level 2 done, and on down into the Library. */
async function downTheWetStair(page: Page): Promise<void> {
  await use(page, 'bone-door');
  await drain(page);
  expect(await page.evaluate(() => window.__engine!.objectState('bone-door').removed)).toBe(true);
  await use(page, 'library-stair');
  await drain(page);
  expect((await logged(page)).some((text) => text.startsWith('Entry 4,120'))).toBe(true);
  await expect.poll(() => scene(page)).toBe('reading-room');
  expect(await market(page)).toMatchObject({ status: 'completed' });
  expect(await library(page)).toMatchObject({ status: 'active', done: ['reach-the-library'] });
}

/** Sela paid with a name of the party's own: two Stress each, and the key. */
async function payTheBroker(page: Page): Promise<void> {
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
}

test('the Ashwell, Level 1: begun through a camp’s portal, Ketch heard, the Throat cleared, the gate opened and the stair taken into the Market', async ({ page }) => {
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
  // A game of its own: Load Game lists it under the name of whoever leads the party, and has no Ashwell from the start.
  const begun = new URL(page.url()).searchParams.get('project')!;
  await page.goto('/?menu');
  await page.getByTestId('menu-load').click();
  await expect(page.locator(`[data-testid="menu-load-list"] [data-game="${begun}"] h2`)).toHaveText("The Ashwell (Wren's party)");
  await expect(page.getByTestId('menu-play-ashwell')).toHaveCount(0);
});

test('the Ashwell, Level 2 paid for: the errand in the pit, the Guild\u2019s mark, a name of the party\u2019s own for the key, and back to Ketch', async ({ page }) => {
  test.setTimeout(300_000);
  await levelOne(page);
  await toTheBroker(page);
  // The Broker's box is not to be touched by a customer.
  await use(page, 'brokers-ledger-box');
  await drain(page);
  expect(await lastLine(page)).toBe('A Guild clerk looks at your hand on the box until you take it off.');
  await payTheBroker(page);
  await downTheWetStair(page);
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});

/**
 * Levels 3 and 4, from the Library's foot to the Throne's door: Aud's tinder, the Stacks, the Index and the party's page
 * (and the catalogue burnt), the Choir, the valve, the Saint, and Quim's name for the furnace.
 */
async function levelsThreeAndFour(page: Page): Promise<void> {
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/ashwell-reading-room.png' });

  // Aud Brennock, by her fire: the tinder.
  await use(page, 'aud-brennock');
  await choose(page, 'We are going deeper.');
  await choose(page, '[Take the tinder.]');
  await drain(page);
  expect((await library(page))?.done).toContain('meet-the-kindlers');
  expect((await page.evaluate(() => window.__engine!.carried())).some((c) => c.id === 'auds-tinder')).toBe(true);

  // The Wet Stacks, and the satchel over the water once the ink is still.
  await use(page, 'down-to-the-stacks');
  await drain(page);
  await expect.poll(() => scene(page)).toBe('wet-stacks');
  await fight(page, { x: 7, y: 3 });
  await use(page, 'drowned-satchel');
  await drain(page);
  expect((await library(page))?.done).toContain('clear-the-stacks');

  // The Index: the sealed stair will not open without the party's page; the catalogue gives it, and burns.
  await use(page, 'down-to-the-index');
  await drain(page);
  await expect.poll(() => scene(page)).toBe('index-vault');
  await fight(page, { x: 7, y: 3 });
  // (Tried after the fight: the driver's approach, with nothing drawn walking, crosses no trigger on its way.)
  await page.evaluate(() => {
    const a = window.__engine!;
    a.walkTo(8.5, 10.5);
    a.arrive();
  });
  await use(page, 'furnace-stair');
  await drain(page);
  expect(await scene(page)).toBe('index-vault');
  expect(await lastLine(page)).toBe('The paper does not tear. Written across it, very small: "Bring your page."');
  await use(page, 'catalogue-drawers');
  await drain(page);
  expect((await library(page))?.done).toContain('the-index');
  expect((await logged(page)).some((text) => text.startsWith('The cards go up like dry leaves.'))).toBe(true);
  expect((await page.evaluate(() => window.__engine!.carried())).some((c) => c.id === 'auds-tinder')).toBe(false);
  await page.screenshot({ path: 'test-results/ashwell-index.png' });

  // The page read, and down into the Furnace.
  await use(page, 'furnace-stair');
  await drain(page);
  await expect.poll(() => scene(page)).toBe('ash-nave');
  expect(await library(page)).toMatchObject({ status: 'completed' });
  expect(await furnace(page)).toMatchObject({ status: 'active', done: ['reach-the-furnace'] });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/ashwell-nave.png' });

  // The Furnace Door is too hot; Ilse sends the party to the valve.
  await use(page, 'furnace-door');
  await drain(page);
  expect(await page.evaluate(() => window.__engine!.objectState('furnace-door').removed)).toBe(false);
  await use(page, 'ilse-grey');
  await choose(page, 'The doors are too hot to touch.');
  await choose(page, '[Go to the gallery.]');
  await drain(page);
  expect((await furnace(page))?.done).toContain('hear-the-choir');
  await use(page, 'down-to-the-gallery');
  await drain(page);
  await expect.poll(() => scene(page)).toBe('coal-gallery');
  await fight(page, { x: 7, y: 3 });
  await use(page, 'great-valve');
  await drain(page);
  expect((await furnace(page))?.done).toContain('turn-the-valve');
  await use(page, 'up-from-the-gallery');
  await drain(page);
  await expect.poll(() => scene(page)).toBe('ash-nave');
  await use(page, 'furnace-door');
  await drain(page);
  expect(await page.evaluate(() => window.__engine!.objectState('furnace-door').removed)).toBe(true);

  // The Furnace Hall: the last stair waits for a name; the Saint first.
  await use(page, 'into-the-furnace');
  await drain(page);
  await expect.poll(() => scene(page)).toBe('furnace-hall');
  await fight(page, { x: 7, y: 3 });
  await page.evaluate(() => {
    const a = window.__engine!;
    a.walkTo(8.5, 10.5);
    a.arrive();
  });
  await use(page, 'throne-stair');
  await drain(page);
  expect(await lastLine(page)).toBe('The stair is barred with white-hot iron. The Furnace has not been fed.');
  // The furnace offers each of the party's names; the first, let through, is Wren's.
  const wren = await page.evaluate(() => window.__engine!.stressOf('wren').marked);
  await use(page, 'name-furnace');
  await drain(page);
  expect((await furnace(page))?.done).toContain('the-saint');
  expect(await logged(page)).toContain('Wren writes, and feeds the page to the fire, and watches it go. Afterwards, Wren cannot remember the face of whoever first taught them to hold a sword.');
  expect(await page.evaluate(() => window.__engine!.stressOf('wren').marked)).toBeGreaterThan(wren);
  await page.screenshot({ path: 'test-results/ashwell-furnace.png' });
  await use(page, 'throne-stair');
  await drain(page);
  expect((await logged(page)).some((text) => text.startsWith('Entry 11,040'))).toBe(true);
  await expect.poll(() => scene(page)).toBe('ledger-throne');
  expect(await furnace(page)).toMatchObject({ status: 'completed' });
  expect(await throne(page)).toMatchObject({ status: 'active', done: ['reach-the-throne'] });

}

/** The whole way down, from the menu to the Throne: every level before the last, the Broker paid. */
async function toTheThrone(page: Page): Promise<void> {
  await levelOne(page);
  await toTheBroker(page);
  await payTheBroker(page);
  await downTheWetStair(page);
  await levelsThreeAndFour(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/ashwell-throne.png' });
}

/** Ketch, after it is over: the word she has for how it ended. */
async function ketchAfter(page: Page, said: string): Promise<void> {
  await expect.poll(() => scene(page)).toBe('lantern-and-lye');
  expect(await throne(page)).toMatchObject({ status: 'completed' });
  await use(page, 'mother-ketch');
  await choose(page, said);
  await expect.poll(() => page.evaluate(() => window.__engine!.dialogueOptions())).toEqual(['[Sit down by the fire.]']);
}

test('the Ashwell, Levels 3 and 4: the Library\u2019s page read at the sealed stair, the Furnace fed a name, and down to the Throne', async ({ page }) => {
  test.setTimeout(420_000);
  await toTheThrone(page);
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});

test('the Ashwell, Level 5 ended with the pen: Vane heard out, his pen taken, and Ketch leaves the lamp lit', async ({ page }) => {
  test.setTimeout(420_000);
  await toTheThrone(page);
  await talkTo(page, 'orsolde-vane');
  // He remembers the Index the party burnt; and the name they gave the Broker was their own, so nothing of Ketch.
  await expect.poll(() => page.evaluate(() => window.__engine!.dialogueOptions())).toContain('We burnt your Index.');
  expect(await page.evaluate(() => window.__engine!.dialogueOptions())).not.toContain('You took Ketch\u2019s name.');
  await choose(page, 'We have decided.');
  await choose(page, 'Give us the pen.');
  await choose(page, '[Take it.]');
  await drain(page);
  expect((await throne(page))?.done).toContain('hear-vane');
  expect(await logged(page)).toContain('The Pen ' + 'He holds it out to you as if it were hot. It is not heavy. It is the lightest thing you have ever held, and the moment it is in your hand you know three hundred names you did not know before, and how each of them ended, and that somebody ought to write it down. "There," says Vane. "There. Oh, that is better." He sits back in his chair and closes his eyes and, after a little while, you write him down too: four lines, and one of them is about his hands. You climb back up to the Lantern, because you live there now, more or less. Every evening one of you goes down the rope with a lamp. You take it in turns. You do not talk about it.');
  await ketchAfter(page, 'It is over. We kept his ledger.');
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});

test('the Ashwell, Level 5 ended by leaving: Vane left writing, and Ketch keeps her slate', async ({ page }) => {
  test.setTimeout(420_000);
  await toTheThrone(page);
  await talkTo(page, 'orsolde-vane');
  await choose(page, 'We have decided.');
  await choose(page, 'Keep writing. We are leaving.');
  await choose(page, '[Go.]');
  await drain(page);
  expect(await page.evaluate(() => window.__engine!.inCombat())).toBe(false);
  await ketchAfter(page, 'It is over. We left him to it.');
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});

test('the Ashwell, Level 5 ended in fire: the ledger refused him, Vane and the Written fought, the ledger burnt, Ketch\u2019s slate clean', async ({ page }) => {
  test.setTimeout(420_000);
  await toTheThrone(page);
  // Not while he is writing in it.
  await use(page, 'the-ledger');
  await drain(page);
  expect(await lastLine(page)).toBe('Vane looks up from the page, mildly. "Not yet, I think. Talk to me first."');
  await talkTo(page, 'orsolde-vane');
  await choose(page, 'We have decided.');
  await choose(page, 'We are going to burn the ledger.');
  await choose(page, '[Draw steel.]');
  await drain(page);
  await expect.poll(() => page.evaluate(() => window.__engine!.inCombat()), { timeout: 15_000 }).toBe(true);
  expect((await page.evaluate(() => window.__engine!.adversaries())).sort()).toEqual(['orsolde-vane', 'the-written-1', 'the-written-2', 'the-written-3']);
  await win(page);
  await use(page, 'the-ledger');
  await drain(page);
  expect((await logged(page)).some((text) => text.startsWith('Ash It takes a long time to catch.'))).toBe(true);
  await ketchAfter(page, 'It is over. We burnt his ledger.');
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
