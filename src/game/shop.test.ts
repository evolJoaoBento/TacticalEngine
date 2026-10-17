/**
 * A shop and a chest, as the page reads them (`game/shop.ts`, `game/prop-use.ts`, the window's view in
 * `ui/play-views.ts`), over a game the engine plays (`WasmGame`, the `.wasm` the page loads): a merchant's
 * conversation opens his shop, and the window lists what he sells with its price and what the party could sell
 * him back; buying and selling through the window are the game's, and the page reads the purse after; the
 * window shuts out of reach and on Close, and the conversation that opened it waits until it is shut. A prop
 * with the Shop function, and a chest, open their own windows. Needs `npm run wasm`, and says so without it.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blankScene, tileOf } from '../engine/scene/grid-from-scene';
import { encounterSchema, projectSchema, sceneSchema } from '../engine/scene/schema';
import { blankSheet } from '../engine/character/sheet';
import { characterSheetSchema } from '../engine/character/sheet-schema';
import { dialogueSchema } from '../engine/dialogue/schema';
import { itemSchema } from '../engine/content/items';
import { EditorSession, addAdversary, addDeco, addDialogue, addEncounter, addItem, addSheet, setSpawns } from '../editor/session';
import { FIXTURE_ADVERSARIES, FIXTURE_FOE } from '../../tests/fixtures/adversaries';
import { buildProjectScene, type DemoScene } from './demo-scene';
import { inCombat, scriptPending } from './moment';
import { containerContents, openContainer, shopOpen, withinReach } from './prop-use';
import { buyBackPrice, offerFor, purse, sellables, shopOf } from './shop';
import { shippedContent } from './shipped';
import { talkingView } from './ui/play-views';
import { WasmEngine } from './wasm-engine';
import { WasmGame } from './wasm-game';

const here = dirname(fileURLToPath(import.meta.url));
const WASM = resolve(here, '../../public/wasm/engine.wasm');
const built = existsSync(WASM);

const KARA = characterSheetSchema.parse(
  blankSheet('kara', 'sentinel', { name: 'Kara', ancestryId: 'human', armorId: 'ringmail', primaryWeaponId: 'longsword', subclassId: 'shieldbearer' }),
);
const STOCK = { currency: 'gold', stock: [{ item: 'draught', price: 5 }, { item: 'shield', price: 8, count: 1 }] };

/** A room with Kara, a merchant three tiles off, a stall that sells the same, and a chest. */
function room(): DemoScene {
  const s = new EditorSession(
    projectSchema.parse({ id: 'shop', name: 'Shop', scenes: [sceneSchema.parse({ ...blankScene('hall', 12, 8), spawns: [{ x: 1, y: 4 }] })], startScene: 'hall' }),
  );
  s.project.adversaries.push(...FIXTURE_ADVERSARIES);
  s.run(addSheet(KARA));
  for (const [id, name] of [['gold', 'Gold'], ['draught', 'A draught'], ['shield', 'A shield']] as const) {
    s.run(addItem(itemSchema.parse({ id, name, kind: 'trinket', stackable: true })));
  }
  s.run(addItem(itemSchema.parse({ id: 'ring', name: 'A silver ring', kind: 'trinket', value: 9 })));
  s.run(addItem(itemSchema.parse({ id: 'key', name: 'An iron key', kind: 'key' })));
  s.project.items.find((item) => item.id === 'draught')!.value = 40;
  s.run(addDialogue(dialogueSchema.parse({
    id: 'haggle',
    start: 'hello',
    nodes: [
      { id: 'hello', lines: [{ text: 'Buying?' }], choices: [{ text: 'Show me', goto: 'wares' }, { text: 'No', goto: 'bye' }] },
      { id: 'wares', kind: 'consequence', onEnter: [{ kind: 'openShop' }], goto: 'bye' },
      { id: 'bye', lines: [{ text: 'Safe roads.' }] },
    ],
  })));
  s.run(setSpawns('hall', [{ x: 1, y: 4 }]));
  s.run(addEncounter('hall', encounterSchema.parse({ id: 'camp', startsOnTrigger: false })));
  s.run(addAdversary('hall', 'camp', { id: 'tobin', adversary: FIXTURE_FOE, position: { x: 4, y: 4 }, interaction: { kind: 'friendly', dialogue: 'haggle', shop: STOCK } }));
  s.run(addDeco('hall', { id: 'stall', model: 'crate-prop', position: { x: 1, y: 2 }, rotation: 0, function: { kind: 'shop', shop: STOCK } }));
  s.run(addDeco('hall', { id: 'chest', model: 'crate-prop', position: { x: 1, y: 6 }, rotation: 0, function: { kind: 'container', items: [{ item: 'draught', count: 2 }] } }));
  const demo = buildProjectScene(s.project, 'shop');
  return demo;
}

/** The room, set up as a test needs it, and then played by the engine - told the page's game as it stands. */
async function playing(setUp: (demo: DemoScene) => void = () => undefined): Promise<{ demo: DemoScene; game: WasmGame }> {
  const demo = room();
  setUp(demo);
  const game = new WasmGame(demo, await WasmEngine.load(readFileSync(WASM)), shippedContent());
  return { demo, game };
}

/**
 * Talk to the merchant - the walk up to him drawn, as the page tells the game once it is (`arrived`) - and ask to
 * see his wares; the conversation walks on past the consequence.
 */
function browse(demo: DemoScene, game: WasmGame): void {
  game.attackWithSelected('tobin');
  game.arrived();
  const view = scriptPending(demo)!.dialogue!.view!;
  game.answerPending({ kind: 'choose', index: view.options.find((o) => o.text === 'Show me')!.index });
}

describe("a merchant's shop, as the page reads it", () => {
  if (!built) console.warn(`${WASM} is not built: \`npm run wasm\` builds it, and these are skipped until it is`);

  it.skipIf(!built)('opens from his conversation: the window lists what he sells, with a price on each line and the purse', async () => {
    const { demo, game } = await playing((d) => d.world.addItem('gold', 12));
    browse(demo, game);
    expect(openContainer(demo)).toBe('tobin');
    expect(shopOpen(demo)).toBe(true);
    expect(containerContents(demo, 'tobin')).toEqual([
      { item: 'draught', name: 'A draught', count: Infinity, price: 5 },
      { item: 'shield', name: 'A shield', count: 1, price: 8 },
    ]);
    const view = game.containerView(() => true, () => undefined)!;
    expect(view.id).toBe('tobin');
    expect(view.paidIn).toEqual({ name: 'Gold', held: 12 });
    expect(view.lines.map((line) => [line.item, line.price])).toEqual([['draught', 5], ['shield', 8]]);
    // Still talking, on the line after the wares - held until the shop is shut, and not a fight.
    expect(talkingView(demo)).toMatchObject({ lines: [{ text: 'Safe roads.' }], held: 'Close the shop to go on.' });
    expect(inCombat(demo)).toBe(false);
  });

  it.skipIf(!built)('buys and sells through the window: the game takes the price, and the page reads the purse after', async () => {
    const { demo, game } = await playing((d) => d.world.addItem('gold', 12));
    browse(demo, game);
    let redrawn = 0;
    const window = () => game.containerView(() => true, () => redrawn++)!;
    window().onTake('draught');
    expect(redrawn).toBe(1);
    expect(purse(demo, shopOf(demo, 'tobin')!)).toBe(7);
    expect(demo.world.hasItem('draught', 1)).toBe(true);
    // What the party could sell back: his own lines, for half.
    expect(sellables(demo, 'tobin')).toEqual([{ item: 'draught', name: 'A draught', held: 1, price: 2 }]);
    expect(window().selling?.map((line) => [line.item, line.price])).toEqual([['draught', 2]]);
    window().onSell!('draught');
    expect(redrawn).toBe(2);
    expect(purse(demo, shopOf(demo, 'tobin')!)).toBe(9);
    expect(demo.world.hasItem('draught', 1)).toBe(false);
    // A line with a count, bought out: gone from the window.
    window().onTake('shield');
    expect(window().lines.map((line) => line.item)).toEqual(['draught']);
  });

  it.skipIf(!built)('shuts out of reach and on Close, and the conversation that opened it goes on once it is shut', async () => {
    const { demo, game } = await playing();
    browse(demo, game);
    expect(game.answerPending({ kind: 'continue' }).status).toBe('refused');
    // Out of reach: no window, and it is shut.
    expect(game.containerView(() => false, () => undefined)).toBeNull();
    expect(openContainer(demo)).toBeNull();
    expect(talkingView(demo)?.held).toBeUndefined();
    game.answerPending({ kind: 'continue' });
    expect(demo.pending).toBeNull();
    // Again, shut by its Close.
    browse(demo, game);
    game.containerView(() => true, () => undefined)!.onClose();
    expect(openContainer(demo)).toBeNull();
  });
});

describe('a stall and a chest, as the page reads them', () => {
  it.skipIf(!built)('opens a prop with the Shop function in its own window, which sells the same way', async () => {
    const { demo, game } = await playing((d) => {
      d.world.addItem('gold', 8);
      d.state.moveEntity('kara', tileOf(d.grid, { x: 1, y: 3 }));
    });
    expect(withinReach(demo, 'stall', 1)).toBe(true);
    game.useSelectedOn('stall');
    expect(openContainer(demo)).toBe('stall');
    game.containerView(() => true, () => undefined)!.onTake('shield');
    expect(purse(demo, shopOf(demo, 'stall')!)).toBe(0);
  });

  it.skipIf(!built)('shows what a chest holds, and each thing taken goes into the pack and out of the chest', async () => {
    const { demo, game } = await playing((d) => d.state.moveEntity('kara', tileOf(d.grid, { x: 1, y: 5 })));
    game.useSelectedOn('chest');
    expect(openContainer(demo)).toBe('chest');
    expect(shopOpen(demo)).toBe(false);
    const view = game.containerView(() => true, () => undefined)!;
    expect(view.paidIn).toBeUndefined();
    expect(view.lines.map((line) => [line.item, line.count])).toEqual([['draught', 2]]);
    view.onTake('draught');
    expect(containerContents(demo, 'chest').map((line) => [line.item, line.count])).toEqual([['draught', 1]]);
    expect(demo.world.hasItem('draught', 1)).toBe(true);
  });
});

describe('what a merchant pays', () => {
  it('is half his own price for his own lines, half the worth of the rest, and nothing for what is worth nothing', () => {
    expect([buyBackPrice(5), buyBackPrice(8), buyBackPrice(1), buyBackPrice(0)]).toEqual([2, 4, 1, 0]);
    const demo = room();
    for (const item of ['ring', 'key', 'draught']) demo.world.addItem(item, 1);
    const shop = shopOf(demo, 'tobin')!;
    expect(offerFor(demo, shop, 'ring')).toBe(4);
    expect(offerFor(demo, shop, 'key')).toBe(0);
    expect(offerFor(demo, shop, 'draught')).toBe(2);
    expect(sellables(demo, 'tobin').map((line) => [line.item, line.price])).toEqual([['draught', 2], ['ring', 4]]);
  });

  it("is the shop's own share of the worth when it names one: a fence less, a temple all of it, nought nothing", () => {
    expect([buyBackPrice(10, 20), buyBackPrice(10, 100), buyBackPrice(10, 0), buyBackPrice(3, 10)]).toEqual([2, 10, 0, 1]);
    const demo = room();
    demo.world.addItem('ring', 1);
    const shop = shopOf(demo, 'tobin')!;
    shop.buysAt = 25;
    expect(offerFor(demo, shop, 'ring')).toBe(2);
    shop.buysAt = 100;
    expect(offerFor(demo, shop, 'ring')).toBe(9);
    shop.buysAt = 0;
    expect(sellables(demo, 'tobin')).toEqual([]);
  });
});
