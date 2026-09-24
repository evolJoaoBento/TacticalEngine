/**
 * Buying (`game/shop.ts`): a merchant's conversation opens his shop, the window lists what he sells
 * with its price, and buying pays from the party pack - refused when it cannot pay, a line with a
 * count sold out for good, across a save. A prop with the Shop function sells the same way. And
 * he buys back what he sells, for half his price.
 */

import { describe, it, expect } from 'vitest';
import { blankScene, tileOf } from '../engine/scene/grid-from-scene';
import { encounterSchema, projectSchema, sceneSchema } from '../engine/scene/schema';
import { blankSheet } from '../engine/character/sheet';
import { characterSheetSchema } from '../engine/character/sheet-schema';
import { dialogueSchema } from '../engine/dialogue/schema';
import { itemSchema } from '../engine/content/items';
import { EditorSession, addAdversary, addDeco, addDialogue, addEncounter, addItem, addSheet, setSpawns } from '../editor/session';
import { FIXTURE_ADVERSARIES, FIXTURE_FOE } from '../../tests/fixtures/adversaries';
import { answerPending, attackWithSelected, buildProjectScene, useSelectedOn, type DemoScene } from './demo-scene';
import { scriptPending } from './moment';
import { containerContents, openContainer, takeFromContainer } from './prop-use';
import { buyBackPrice, offerFor, sellTo, sellables, shopOf } from './shop';

const KARA = characterSheetSchema.parse(
  blankSheet('kara', 'sentinel', { name: 'Kara', ancestryId: 'human', armorId: 'ringmail', primaryWeaponId: 'longsword', subclassId: 'shieldbearer' }),
);
const STOCK = { currency: 'gold', stock: [{ item: 'draught', price: 5 }, { item: 'shield', price: 8, count: 1 }] };

/** A room with Kara, a merchant three tiles off, and a stall that sells the same. */
function room(): DemoScene {
  const s = new EditorSession(
    projectSchema.parse({ id: 'shop', name: 'Shop', scenes: [sceneSchema.parse({ ...blankScene('hall', 12, 8), spawns: [{ x: 1, y: 4 }] })], startScene: 'hall' }),
  );
  s.project.adversaries.push(...FIXTURE_ADVERSARIES);
  s.run(addSheet(KARA));
  for (const [id, name] of [['gold', 'Gold'], ['draught', 'A draught'], ['shield', 'A shield']] as const) {
    s.run(addItem(itemSchema.parse({ id, name, kind: 'trinket', stackable: true })));
  }
  // Not his: a ring worth something, a key worth nothing to anybody but its door, and a draught
  // valued higher than he sells it for - his own price wins.
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
  const demo = buildProjectScene(s.project, 'shop');
  demo.askDefender = false;
  return demo;
}

const gold = (demo: DemoScene): number => {
  let held = 0;
  while (demo.world.hasItem('gold', held + 1)) held++;
  return held;
};

/** Talk to the merchant and ask to see his wares; the conversation walks on past the consequence. */
function browse(demo: DemoScene): void {
  attackWithSelected(demo, 'tobin');
  const view = scriptPending(demo)!.dialogue!.view!;
  answerPending(demo, { kind: 'choose', index: view.options.find((o) => o.text === 'Show me')!.index });
  for (let i = 0; i < 5 && demo.pending !== null; i++) answerPending(demo, { kind: 'continue' });
}

describe("a merchant's shop", () => {
  it('opens from his conversation, with a price on everything he sells', () => {
    const demo = room();
    browse(demo);
    expect(openContainer(demo)).toBe('tobin');
    expect(containerContents(demo, 'tobin')).toEqual([
      { item: 'draught', name: 'A draught', count: Infinity, price: 5 },
      { item: 'shield', name: 'A shield', count: 1, price: 8 },
    ]);
  });

  it('takes the price out of the party pack and puts the thing in it', () => {
    const demo = room();
    demo.world.addItem('gold', 12);
    browse(demo);
    expect(takeFromContainer(demo, 'tobin', 'draught')).toBe(true);
    expect(gold(demo)).toBe(7);
    expect(demo.world.hasItem('draught', 1)).toBe(true);
    expect(demo.log.some((line) => line.text === 'Kara buys A draught for 5 gold.')).toBe(true);
  });

  it('refuses when the party cannot pay, and takes nothing', () => {
    const demo = room();
    demo.world.addItem('gold', 4);
    browse(demo);
    expect(takeFromContainer(demo, 'tobin', 'draught')).toBe(false);
    expect(gold(demo)).toBe(4);
    expect(demo.world.hasItem('draught', 1)).toBe(false);
    expect(demo.log.some((line) => line.text.startsWith('Not enough gold for A draught'))).toBe(true);
  });

  it('sells a line with a count until it is gone, and it stays gone across a save', () => {
    const demo = room();
    demo.world.addItem('gold', 30);
    browse(demo);
    expect(takeFromContainer(demo, 'tobin', 'shield')).toBe(true);
    expect(containerContents(demo, 'tobin').map((line) => line.item)).toEqual(['draught']);
    expect(takeFromContainer(demo, 'tobin', 'shield')).toBe(false);
    demo.state.restore(JSON.parse(JSON.stringify(demo.state.snapshot())));
    expect(containerContents(demo, 'tobin').map((line) => line.item)).toEqual(['draught']);
  });
});

describe('a prop with the Shop function', () => {
  it('opens its own window when used, and sells the same way', () => {
    const demo = room();
    demo.world.addItem('gold', 8);
    demo.state.moveEntity('kara', tileOf(demo.grid, { x: 1, y: 3 }));
    useSelectedOn(demo, 'stall');
    expect(openContainer(demo)).toBe('stall');
    expect(takeFromContainer(demo, 'stall', 'shield')).toBe(true);
    expect(gold(demo)).toBe(0);
  });
});

describe('selling to a merchant', () => {
  it('buys back what he sells, for half his price, rounded down and never nothing', () => {
    expect([buyBackPrice(5), buyBackPrice(8), buyBackPrice(1), buyBackPrice(0)]).toEqual([2, 4, 1, 0]);
    const demo = room();
    demo.world.addItem('draught', 2);
    demo.world.addItem('gold', 3);
    // Only his own lines, only what the party carries, and never his own coin.
    expect(sellables(demo, 'tobin')).toEqual([{ item: 'draught', name: 'A draught', held: 2, price: 2 }]);
    expect(sellTo(demo, 'tobin', 'draught')).toBe(true);
    expect(gold(demo)).toBe(5);
    expect(demo.world.hasItem('draught', 2)).toBe(false);
    expect(demo.log.some((line) => line.text === 'Kara sells A draught for 2 gold.')).toBe(true);
    expect(sellTo(demo, 'tobin', 'gold')).toBe(false);
  });

  it('puts a limited line back on his shelf when he buys one back', () => {
    const demo = room();
    demo.world.addItem('gold', 8);
    browse(demo);
    takeFromContainer(demo, 'tobin', 'shield');
    expect(containerContents(demo, 'tobin').map((line) => line.item)).toEqual(['draught']);
    expect(sellTo(demo, 'tobin', 'shield')).toBe(true);
    expect(gold(demo)).toBe(4);
    expect(containerContents(demo, 'tobin').map((line) => line.item)).toEqual(['draught', 'shield']);
  });
});

describe('selling what a merchant does not stock', () => {
  it('fetches half its value, and an item with no value is not bought at all', () => {
    const demo = room();
    demo.world.addItem('ring', 1);
    demo.world.addItem('key', 1);
    demo.world.addItem('draught', 1);
    const shop = shopOf(demo, 'tobin')!;
    expect(offerFor(demo, shop, 'ring')).toBe(4);
    expect(offerFor(demo, shop, 'key')).toBe(0);
    // His own line is priced by what he asks for it, not by what it is said to be worth.
    expect(offerFor(demo, shop, 'draught')).toBe(2);
    // His lines first, then the rest of what the party carries that is worth something.
    expect(sellables(demo, 'tobin').map((line) => [line.item, line.price])).toEqual([['draught', 2], ['ring', 4]]);
    expect(sellTo(demo, 'tobin', 'ring')).toBe(true);
    expect(gold(demo)).toBe(4);
    expect(sellTo(demo, 'tobin', 'key')).toBe(false);
    expect(demo.world.hasItem('key', 1)).toBe(true);
  });
});

describe("a shop's own buy-back rate", () => {
  it('pays its share of the worth instead of half: a fence less, a temple all of it, nought nothing', () => {
    expect([buyBackPrice(10, 20), buyBackPrice(10, 100), buyBackPrice(10, 0), buyBackPrice(3, 10)]).toEqual([2, 10, 0, 1]);
    const demo = room();
    const shop = shopOf(demo, 'tobin')!;
    demo.world.addItem('ring', 1);
    // Half, when it says nothing.
    expect(offerFor(demo, shop, 'ring')).toBe(4);
    shop.buysAt = 25;
    expect(offerFor(demo, shop, 'ring')).toBe(2);
    expect(offerFor(demo, shop, 'shield')).toBe(2);
    shop.buysAt = 100;
    expect(offerFor(demo, shop, 'ring')).toBe(9);
    shop.buysAt = 0;
    expect(sellables(demo, 'tobin')).toEqual([]);
    expect(sellTo(demo, 'tobin', 'ring')).toBe(false);
  });
});
