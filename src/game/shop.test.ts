/**
 * Buying (`game/shop.ts`): a merchant's conversation opens his shop, the window lists what he sells
 * with its price, and buying pays from the party pack - refused when it cannot pay, a line with a
 * count sold out for good, across a save. A prop with the Shop function sells the same way.
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
