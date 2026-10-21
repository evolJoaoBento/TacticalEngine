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

/** Every prompt waiting answered, a roll asked for rolled - not let pass - and its result read. */
async function roll(page: Page): Promise<void> {
  await page.evaluate(() => {
    const a = window.__engine!;
    for (let n = 0; n < 20 && a.pendingKind() !== null; n++) {
      const kind = a.pendingKind();
      a.answer(kind === 'check' ? { kind: 'roll' } : kind === 'rolled' ? { kind: 'answered' } : { kind: 'choose', index: 0 });
    }
  });
}

/**
 * A fight begun by walking onto the cell that wakes it, and won: every adversary in it wounded to a blow from down by
 * the driver, then struck by whoever can reach, the room taking its turns between. Real blows, so the fight ends as one
 * does, and whatever waits on its end sees it end.
 */
async function fight(page: Page, at: { x: number; y: number }, talkers: readonly string[] = []): Promise<void> {
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
  await win(page, talkers);
}

/**
 * The fight going on, won: every adversary wounded to a blow from down, then struck by whoever can reach. One who stops
 * to talk at a threshold (`talkers`) is left four Hit Points, and struck first: a blow, not the driver's wound, is what
 * brings a creature to its threshold, and from four any blow leaves it under its line, and standing to say so.
 */
async function win(page: Page, talkers: readonly string[] = []): Promise<void> {
  for (let round = 0; round < 40 && (await page.evaluate(() => window.__engine!.inCombat())); round++) {
    await page.evaluate((talkers) => {
      const a = window.__engine!;
      // The party held up by the same hand: the levels the Ashwell grants are never taken here (the level-up panel
      // has its own tests), so a level-1 company is fighting tier-2 creatures, and what is tested is the level.
      for (const member of a.party()) a.wound(member, 0);
      for (const foe of a.adversaries()) a.wound(foe, a.hitPoints(foe).max - (talkers.includes(foe) ? 4 : 1));
      const order = () => [...a.adversaries()].sort((x, y) => Number(talkers.includes(y)) - Number(talkers.includes(x)));
      for (const member of a.party()) {
        const foe = order()[0];
        if (foe === undefined) break;
        a.select(member);
        a.attack(foe);
        for (let n = 0; n < 20 && a.pendingKind() !== null; n++) a.answer({ kind: 'choose', index: 0 });
      }
    }, talkers);
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
  // Half way down the gallery the water carries the sound to the camp. Nails, at half, would sooner talk: she says what
  // Annick was, and goes.
  await fight(page, { x: 16, y: 2 }, ['nails']);
  expect(await logged(page)).toContain('Nails picks up her tally-board and walks off into the dark the way you came, counting under her breath.');
  await use(page, 'wellrat-takings');
  await drain(page);
  expect((await quest(page))?.done).toContain('break-the-wellrats');

  // Down the passage from the camp to the Sump, where the Warden has the gate's key.
  await use(page, 'down-to-the-sump');
  await drain(page);
  await expect.poll(() => page.evaluate(() => window.__engine!.sceneId())).toBe('the-sump');
  // Annick, at four tenths, is told what he was - Nails said - and gives the key himself; his box is still his hoard.
  await fight(page, { x: 8, y: 3 }, ['hob-annick']);
  expect((await logged(page)).some((text) => text.includes('Gate’s that way. I’ll wipe it after you.'))).toBe(true);
  expect((await quest(page))?.done).toContain('the-warden');
  await use(page, 'wardens-strongbox');
  await drain(page);
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

/**
 * Level 2 as far as the Broker: Grale's errand, the Charnel Pit's fight - the Sexton ringing the bell at the party's first
 * roll, and talked off his rope - and its bell-rope, the mark and the Guild's door.
 */
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
  await fight(page, { x: 8, y: 3 }, ['sexton-mott']);
  const pit = await logged(page);
  expect(pit).toContain('Mott leans his whole weight on the rope. Overhead, through the stone, the market bell begins to swing.');
  // Talked off his rope, he stays on his ledge, on nobody's side.
  expect(await page.evaluate(() => window.__engine!.adversaries())).not.toContain('sexton-mott');
  await use(page, 'bell-rope');
  await drain(page);
  expect((await market(page))?.done).toContain('clear-the-pit');
  expect(await lastLine(page)).toBe('Knotted into the rope at the height of a man\u2019s hands is a strip of Guild paper, many times folded: ONE RINGING - ONE TOOTH - A.G. It is stamped with the Usher\u2019s seal.');
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

test('the Ashwell, Level 1\u2019s corners: a night by the hearth, Ketch\u2019s shelf, the stone at the shaft\u2019s foot, the Kennel\u2019s ring brought home, and the slate', async ({ page }) => {
  test.setTimeout(240_000);
  await begin(page);
  await use(page, 'mother-ketch');
  await expect.poll(() => page.evaluate(() => window.__engine!.dialogueOptions())).toContain('We are going down.');
  await page.evaluate(() => window.__engine!.answer({ kind: 'choose', index: 2 }));
  await page.evaluate(() => window.__engine!.answer({ kind: 'choose', index: 0 }));
  await drain(page);

  // A night by the hearth, for five gold: the party mended as far as a night goes.
  await page.evaluate(() => {
    const a = window.__engine!;
    a.giveItem('gold', 5);
    for (const member of a.party()) a.wound(member, 3);
  });
  const gold = () => page.evaluate(() => window.__engine!.carried().find((c) => c.id === 'gold')?.quantity ?? 0);
  const before = await gold();
  await use(page, 'the-hearth');
  await drain(page);
  expect(await lastLine(page)).toContain('You sleep in your boots, and wake stiff, and better.');
  expect(await gold()).toBe(before - 5);
  expect(await page.evaluate(() => window.__engine!.party().map((m) => window.__engine!.hitPoints(m).marked))).toEqual([0, 0, 0, 0]);
  // Her shelf: a seller's window, potions and draughts.
  await use(page, 'ketchs-shelf');
  const shelf = page.getByTestId('container');
  await expect(shelf).toHaveAttribute('data-container', 'ketchs-shelf');
  await expect(shelf).toContainText('Healing draught');
  await page.screenshot({ path: 'test-results/ashwell-lantern-shelf.png' });
  await shelf.getByTestId('container-close').click();
  await expect(page.getByTestId('container')).toHaveCount(0);

  // Down, and the loose stone at the shaft's foot: an Instinct roll, once - the token behind it, or only wet stone.
  await use(page, 'the-well');
  await drain(page);
  await expect.poll(() => scene(page)).toBe('the-throat');
  await use(page, 'loose-stone');
  await roll(page);
  const stone = await lastLine(page);
  const token = (await page.evaluate(() => window.__engine!.carried().map((c) => c.id))).includes('keepers-token');
  expect(token ? stone : 'nothing', stone).toBe(token ? 'One stone in the wall is drier than the rest. Behind it, wrapped in oilcloth, a brass token on a thong: HALLOWMERE WELL - KEEPER.' : 'nothing');
  if (!token) expect(stone).toBe('Wet stone, and more wet stone. Whatever was hidden here, it stays hidden.');

  // The Kennel: its hounds and the thing in the wet, and among the bones in its chest, a ring.
  await use(page, 'down-to-the-kennel');
  await drain(page);
  await expect.poll(() => scene(page)).toBe('the-kennel');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/ashwell-kennel.png' });
  await fight(page, { x: 3, y: 3 });
  await use(page, 'kennel-chest');
  await expect.poll(() => page.evaluate(() => window.__engine!.container()?.lines.map((line) => line.item) ?? [])).toContain('tams-ring');
  expect(await page.evaluate(() => window.__engine!.take('tams-ring'))).toBe(true);
  await use(page, 'up-from-the-kennel');
  await drain(page);
  await expect.poll(() => scene(page)).toBe('the-throat');
  await use(page, 'rope-up');
  await drain(page);
  await expect.poll(() => scene(page)).toBe('lantern-and-lye');

  // Ketch, given it back: a draught from under the bar, and the slate remembers.
  await use(page, 'mother-ketch');
  await choose(page, 'We found this in the Kennel.');
  await choose(page, '[Leave her to it.]');
  await drain(page);
  const carried = await page.evaluate(() => window.__engine!.carried().map((c) => c.id));
  expect(carried).not.toContain('tams-ring');
  expect(carried).toContain('healing-draught');
  await use(page, 'ketchs-slate');
  await drain(page);
  expect(await logged(page)).toContain('Halfway down, beside TAM KETCH, somebody has drawn a small careful ring.');
  // And only once: given back, it is not offered again.
  await use(page, 'mother-ketch');
  await expect.poll(() => page.evaluate(() => window.__engine!.dialogueOptions())).toContain('We are going down.');
  expect(await page.evaluate(() => window.__engine!.dialogueOptions())).not.toContain('We found this in the Kennel.');
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
  await payTheBroker(page);
  await downTheWetStair(page);
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});

test('the Ashwell, Level 2\u2019s third way: a ring sold to the Guild, Grale caught and his purse refused, and his own name the Broker\u2019s price', async ({ page }) => {
  test.setTimeout(300_000);
  await levelOne(page);
  // The clerk buys keepsakes: what the Guild does with them is sell them back up, and Ketch is good custom.
  await page.evaluate(() => window.__engine!.giveItem('tams-ring', 1));
  const gold = () => page.evaluate(() => window.__engine!.carried().find((c) => c.id === 'gold')?.quantity ?? 0);
  const before = await gold();
  await use(page, 'clerk-wenna');
  await choose(page, 'Sell her the wedding band.');
  await choose(page, '[Take the coin.]');
  await drain(page);
  expect(await gold()).toBe(before + 30);
  expect((await page.evaluate(() => window.__engine!.carried().map((c) => c.id)))).not.toContain('tams-ring');
  await use(page, 'the-market-bell');
  await drain(page);
  expect(await lastLine(page)).toContain('Nobody stands near it, and nobody looks at it.');

  await toTheBroker(page);
  await use(page, 'up-from-the-counting-house');
  await drain(page);
  await expect.poll(() => scene(page)).toBe('ossuary-market');
  // The chit in the rope is Grale's: he pays for the ringing, and would pay for quiet.
  await use(page, 'usher-grale');
  await choose(page, 'Your sexton rings the bell. You pay him to.');
  await choose(page, '[Leave it in his hand.]');
  await drain(page);
  expect(await gold()).toBe(before + 30);
  await use(page, 'the-market-bell');
  await drain(page);
  expect(await lastLine(page)).toContain('its rope cut short');
  await use(page, 'down-to-the-counting-house');
  await drain(page);
  await expect.poll(() => scene(page)).toBe('counting-house');

  // Sela: Annick was spared above, so his is a living name now, not a dead man's - and Grale's is for sale.
  await talkTo(page, 'sela-marrow');
  const offered = await page.evaluate(() => window.__engine!.dialogueOptions());
  expect(offered).toContain('Take Hob Annick\u2019s. He gave us his key; he can spare his name.');
  expect(offered).not.toContain('Hob Annick is dead. Take his.');
  await choose(page, 'Take Usher Grale\u2019s. He rings your pit bell for bone.');
  await choose(page, '[Take the key.]');
  await drain(page);
  expect(await page.evaluate(() => window.__engine!.inCombat())).toBe(false);
  expect((await market(page))?.done).toContain('the-broker');
  // Vane's page below the Bone Door knows what the key cost.
  await downTheWetStair(page);
  expect(await logged(page)).toContain('Under it, newer ink: "They sold the Broker her own usher. Grale will be weighed by noon. I did not see that coming, and I see most things. I have given them a line of their own for it."');
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});

/**
 * Levels 3 and 4, from the Library's foot to the Throne's door: Aud's tinder, the Stacks and the Kindlers' cards, the
 * Index reading the party aloud and their page - with the name they gave the Broker found in it, read back, and said so
 * at the sealed stair - and the catalogue burnt; the Choir told why they sing, the valve turned by strength, the Saint's
 * bellows and his silent hymn, Wren's name for the furnace, the Choir sent up, and the page at the foot that knows it.
 */
async function levelsThreeAndFour(page: Page): Promise<void> {
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/ashwell-reading-room.png' });

  // Aud Brennock, by her fire: where the name the party gave the Broker went, and the tinder.
  await use(page, 'aud-brennock');
  await choose(page, 'The Broker has one of our names.');
  await choose(page, '[Leave her to the fire.]');
  await drain(page);
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
  // The Kindlers' cards, read against Aud's advice: hers is among them, and reading costs the reader.
  await use(page, 'kindlers-shelf');
  await drain(page);
  expect(await lastLine(page)).toBe('Out in the water, something turns over slowly, as if it had heard its name. Whoever read the cards marks a Stress.');

  // The Index: the sealed stair will not open without the party's page; the catalogue gives it, and burns.
  await use(page, 'down-to-the-index');
  await drain(page);
  await expect.poll(() => scene(page)).toBe('index-vault');
  // At the party's first roll the Index begins to read them aloud, the faster for the name of theirs the Broker filed.
  // Swung at whole first, as a party meets it: the driver's wounds would leave it a blow from down, and a blow that
  // lands on the first roll fells it before it can answer.
  const reading = 'Every drawer in the Index slides open at once, and it begins to read aloud. It is reading about you.';
  await page.evaluate(() => {
    const a = window.__engine!;
    a.walkTo(7.5, 3.5);
    a.arrive();
  });
  await expect.poll(() => page.evaluate(() => window.__engine!.inCombat()), { timeout: 15_000 }).toBe(true);
  for (let round = 0; round < 6 && !(await logged(page)).includes(reading); round++) {
    await page.evaluate(() => {
      const a = window.__engine!;
      for (const member of a.party()) {
        a.wound(member, 0);
        a.select(member);
        a.attack('undertow-index');
        for (let n = 0; n < 20 && a.pendingKind() !== null; n++) a.answer({ kind: 'choose', index: 0 });
      }
    });
    await drain(page);
    if (!(await logged(page)).includes(reading)) {
      await page.evaluate(() => window.__engine!.endGmTurn());
      await drain(page);
    }
  }
  const read = await logged(page);
  expect(read).toContain(reading);
  expect(read).toContain('It has one of your names already - the one you gave the Broker, filed - and it reads the faster for it.');
  await win(page);
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
  // The name they gave the Broker is filed with their page, and read back; and Aud's card is remembered.
  const filed = await logged(page);
  expect(filed.some((text) => text.startsWith('Behind your page is one card more'))).toBe(true);
  expect(filed.some((text) => text.startsWith('Aud\u2019s drawer stands open too'))).toBe(true);
  expect((await logged(page)).some((text) => text.startsWith('The cards go up like dry leaves.'))).toBe(true);
  expect((await page.evaluate(() => window.__engine!.carried())).some((c) => c.id === 'auds-tinder')).toBe(false);
  await page.screenshot({ path: 'test-results/ashwell-index.png' });

  // The page read, and down into the Furnace.
  await use(page, 'furnace-stair');
  await drain(page);
  await expect.poll(() => scene(page)).toBe('ash-nave');
  // The page says what they did in the Library.
  const entry = await logged(page);
  expect(entry.some((text) => text.startsWith('At the foot of the page, newer ink: "They found the name they gave the Broker'))).toBe(true);
  expect(entry).toContain('At the foot of the page, newer ink, shakier than the rest: "They burnt my Index. I felt every card go."');
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
  // The pew page says why the Choir sings; told, they stop, and sit.
  await use(page, 'fourth-page');
  await drain(page);
  await use(page, 'ilse-grey');
  await choose(page, 'Why do they sing?');
  await choose(page, 'They should know.');
  await choose(page, '[Leave her.]');
  await drain(page);
  await use(page, 'chorister-1');
  await drain(page);
  expect(await lastLine(page)).toMatch(/^The chorister sits in the pew/);
  await use(page, 'down-to-the-gallery');
  await drain(page);
  await expect.poll(() => scene(page)).toBe('coal-gallery');
  await fight(page, { x: 7, y: 3 });
  // The valve is a test of strength, tried until it turns: each failure costs a Stress or a burn.
  for (let tries = 0; tries < 12 && !(await furnace(page))?.done.includes('turn-the-valve'); tries++) {
    await page.evaluate(() => {
      const a = window.__engine!;
      for (const member of a.party()) {
        a.wound(member, 0);
        a.markStress(member, 0);
      }
    });
    await use(page, 'great-valve');
    await roll(page);
  }
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
  // At the party's first roll the Saint breathes the furnace over the floor; and hurt, he listens for the Choir, which is
  // silent. Swung at whole first, as at the Index, so he stands to answer.
  const bellows = 'Oswin leans his whole weight on the bellows, singing, and the furnace breathes out across the floor.';
  const silent = 'Oswin lifts his head to listen. The Nave is silent. Nothing comes.';
  await page.evaluate(() => {
    const a = window.__engine!;
    a.walkTo(7.5, 3.5);
    a.arrive();
  });
  await expect.poll(() => page.evaluate(() => window.__engine!.inCombat()), { timeout: 15_000 }).toBe(true);
  for (let round = 0; round < 10 && !((await logged(page)).includes(bellows) && (await logged(page)).includes(silent)); round++) {
    await page.evaluate(() => {
      const a = window.__engine!;
      for (const member of a.party()) {
        a.wound(member, 0);
        a.select(member);
        a.attack('oswin-pell');
        for (let n = 0; n < 20 && a.pendingKind() !== null; n++) a.answer({ kind: 'choose', index: 0 });
      }
    });
    await drain(page);
    if (await page.evaluate(() => window.__engine!.inCombat())) {
      await page.evaluate(() => window.__engine!.endGmTurn());
      await drain(page);
    }
  }
  const breathed = await logged(page);
  expect(breathed).toContain(bellows);
  expect(breathed).toContain(silent);
  await win(page);
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
  // The Saint down, Ilse sends the Choir up the well.
  await use(page, 'out-of-the-furnace');
  await drain(page);
  await expect.poll(() => scene(page)).toBe('ash-nave');
  await use(page, 'ilse-grey');
  await choose(page, 'Oswin Pell has stopped singing.');
  await choose(page, '[Let them go.]');
  await drain(page);
  expect(await page.evaluate(() => window.__engine!.objectState('chorister-1').removed)).toBe(true);
  await use(page, 'into-the-furnace');
  await drain(page);
  await expect.poll(() => scene(page)).toBe('furnace-hall');
  await page.evaluate(() => {
    const a = window.__engine!;
    a.walkTo(8.5, 10.5);
    a.arrive();
  });
  await use(page, 'throne-stair');
  await drain(page);
  const foot = await logged(page);
  expect(foot.some((text) => text.startsWith('Entry 11,040'))).toBe(true);
  // Vane's page at the foot of the stair knows whose name it was, and what went with it, and that the Choir went up.
  expect(foot).toContain('Under it, in the same hand: "Wren gave the Furnace their name, and with it the face of whoever first taught them to hold a sword. I have kept the page. It is on my desk, if Wren wants it back."');
  expect(foot).toContain('And under that: "They sent the Choir up the well. I shall have to read by my own light now. I find I do not mind as much as I expected."');
  await expect.poll(() => scene(page)).toBe('ledger-throne');
  expect(await furnace(page)).toMatchObject({ status: 'completed' });
  expect(await throne(page)).toMatchObject({ status: 'active', done: ['reach-the-throne'] });

}

/**
 * The whole way down, from the menu to the Throne: every level before the last, the Broker paid - and on Vane's
 * desk, the page the Furnace took, taken back, and what went with Wren's name given back with it.
 */
async function toTheThrone(page: Page): Promise<void> {
  await levelOne(page);
  await toTheBroker(page);
  await payTheBroker(page);
  await downTheWetStair(page);
  await levelsThreeAndFour(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/ashwell-throne.png' });
  await use(page, 'the-burnt-page');
  await drain(page);
  // The page's line, and after it the Stress it clears - three Stress, not three Stresss.
  expect(await logged(page)).toContain('Wren clears 3 Stress.');
  expect(await logged(page)).toContain('Under an inkwell on Vane\u2019s desk is the page from the Furnace, Wren\u2019s name on it in Wren\u2019s own hand, scorched at the edges. Wren reads it, and it all comes back: the face of whoever first taught them to hold a sword.');
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
  // He reads the party's record back, and it is enough: the name read back, the Choir sent up, the page taken back.
  await choose(page, 'Then you know what we kept.');
  const kept = await logged(page);
  for (const line of ['"...found the name they sold the Broker, in my Index, and read it back."', '"...sent the Choir up the well."', '"...took back the page the Furnace had, off my own desk."']) expect(kept).toContain(line);
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
  // At the party's first roll he writes the room round him. Swung at whole first, as at the Index, so he stands to.
  const writes = 'Vane takes up the pen again and writes the room. The floor round the lectern is a page now, and you are standing on his lines.';
  for (let round = 0; round < 6 && !(await logged(page)).includes(writes); round++) {
    await page.evaluate(() => {
      const a = window.__engine!;
      for (const member of a.party()) {
        a.wound(member, 0);
        a.select(member);
        a.attack('orsolde-vane');
        for (let n = 0; n < 20 && a.pendingKind() !== null; n++) a.answer({ kind: 'choose', index: 0 });
      }
    });
    await drain(page);
    if (!(await logged(page)).includes(writes) && (await page.evaluate(() => window.__engine!.inCombat()))) {
      await page.evaluate(() => window.__engine!.endGmTurn());
      await drain(page);
    }
  }
  expect(await logged(page)).toContain(writes);
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
