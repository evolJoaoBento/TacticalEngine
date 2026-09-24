/**
 * A conversation is its speaker's (`game/talks.ts`): select somebody else and it is set aside - off
 * the screen, the speaker held where they stand while the rest go on - and select them again and it
 * is back where it was, with the shop it had open. A fight breaks it off; saving and resting wait.
 */

import { describe, it, expect } from 'vitest';
import { blankScene } from '../engine/scene/grid-from-scene';
import { encounterSchema, projectSchema, sceneSchema } from '../engine/scene/schema';
import { blankSheet } from '../engine/character/sheet';
import { characterSheetSchema } from '../engine/character/sheet-schema';
import { dialogueSchema } from '../engine/dialogue/schema';
import { itemSchema } from '../engine/content/items';
import { EditorSession, addAdversary, addDeco, addDialogue, addEncounter, addItem, addSheet, setSpawns } from '../editor/session';
import { FIXTURE_ADVERSARIES, FIXTURE_FOE } from '../../tests/fixtures/adversaries';
import { answerPending, attackWithSelected, buildProjectScene, moveSelectedTo, type DemoScene } from './demo-scene';
import { rest } from './demo-abilities';
import { startEncounter } from './movement';
import { openContainer } from './prop-use';
import { loadGame, saveBlockedBy, saveGame } from './save';
import { approachThenUse } from './arrival';
import { scriptPending } from './moment';
import { talkerOf, talkingAside, syncTalks } from './talks';
import { talkingView } from './ui/play-views';

const KARA = characterSheetSchema.parse(
  blankSheet('kara', 'sentinel', { name: 'Kara', ancestryId: 'human', armorId: 'ringmail', primaryWeaponId: 'longsword', subclassId: 'shieldbearer' }),
);
const TAMSIN = characterSheetSchema.parse({ ...KARA, id: 'tamsin', name: 'Tamsin' });

/** Kara and Tamsin; Tobin three tiles off, who talks and sells; and a raider far off, asleep. */
function room(): DemoScene {
  const s = new EditorSession(
    projectSchema.parse({ id: 't', name: 'T', scenes: [sceneSchema.parse({ ...blankScene('hall', 14, 8), spawns: [{ x: 1, y: 4 }] })], startScene: 'hall' }),
  );
  s.project.adversaries.push(...FIXTURE_ADVERSARIES);
  s.run(addSheet(KARA));
  s.run(addSheet(TAMSIN));
  s.run(setSpawns('hall', [{ x: 1, y: 4 }, { x: 1, y: 5 }]));
  s.run(addItem(itemSchema.parse({ id: 'gold', name: 'Gold', kind: 'trinket', stackable: true })));
  s.run(addItem(itemSchema.parse({ id: 'draught', name: 'A draught', kind: 'trinket', stackable: true })));
  s.run(addDialogue(dialogueSchema.parse({
    id: 'haggle',
    start: 'hello',
    nodes: [
      { id: 'hello', lines: [{ text: 'Buying?' }], choices: [{ text: 'Show me', goto: 'wares' }, { text: 'No', goto: 'bye' }] },
      { id: 'wares', kind: 'consequence', onEnter: [{ kind: 'openShop' }], goto: 'bye' },
      { id: 'bye', lines: [{ text: 'Safe roads.' }] },
    ],
  })));
  s.run(addEncounter('hall', encounterSchema.parse({ id: 'camp', startsOnTrigger: false })));
  s.run(addAdversary('hall', 'camp', {
    id: 'tobin', adversary: FIXTURE_FOE, position: { x: 4, y: 4 },
    interaction: { kind: 'friendly', dialogue: 'haggle', shop: { currency: 'gold', stock: [{ item: 'draught', price: 5 }] } },
  }));
  s.run(addDeco('hall', { id: 'stone', model: 'pillar-prop', position: { x: 1, y: 2 }, rotation: 0, function: { kind: 'interaction', dialogue: 'haggle' } }));
  s.run(addEncounter('hall', encounterSchema.parse({ id: 'raid', startsOnTrigger: false })));
  s.run(addAdversary('hall', 'raid', { id: 'raider', adversary: FIXTURE_FOE, position: { x: 12, y: 1 } }));
  const demo = buildProjectScene(s.project, 'talks');
  demo.askDefender = false;
  demo.party.select('kara');
  return demo;
}

const said = (demo: DemoScene): string[] | undefined => talkingView(demo)?.lines.map((line) => line.text);

describe('a conversation set aside', () => {
  it('leaves the screen when somebody else is selected, and holds the one talking where they stand', () => {
    const demo = room();
    attackWithSelected(demo, 'tobin');
    expect(talkerOf(demo)).toBe('kara');
    expect(said(demo)).toEqual(['Buying?']);

    demo.party.select('tamsin');
    expect(syncTalks(demo)).toBe(true);
    expect(demo.pending).toBeNull();
    expect(talkingView(demo)).toBeNull();
    expect(talkingAside(demo)).toEqual(['kara']);
    expect(demo.party.canCommand('kara')).toBe(false);

    // The rest go on: Tamsin walks, and Kara is not taken along.
    const stood = demo.state.entity('kara')!.tile;
    expect(moveSelectedTo(demo, demo.grid.indexOf(8, 6)).moved).toBe(true);
    expect(demo.state.entity('kara')!.tile).toBe(stood);
    expect(demo.party.linked('kara', 'tamsin')).toBe(true);
  });

  it('comes back where it was when the one talking is selected, and lets them go once it ends', () => {
    const demo = room();
    attackWithSelected(demo, 'tobin');
    demo.party.select('tamsin');
    syncTalks(demo);
    demo.party.select('kara');
    syncTalks(demo);
    expect(said(demo)).toEqual(['Buying?']);
    expect(talkingAside(demo)).toEqual([]);
    const view = talkingView(demo)!;
    answerPending(demo, { kind: 'choose', index: view.options.find((o) => o.text === 'No')!.index });
    for (let i = 0; i < 3 && demo.pending !== null; i++) answerPending(demo, { kind: 'continue' });
    expect(demo.pending).toBeNull();
    expect(demo.party.canCommand('kara')).toBe(true);
  });

  it('takes the shop it had open with it, and brings it back', () => {
    const demo = room();
    attackWithSelected(demo, 'tobin');
    answerPending(demo, { kind: 'choose', index: talkingView(demo)!.options.find((o) => o.text === 'Show me')!.index });
    expect(openContainer(demo)).toBe('tobin');
    demo.party.select('tamsin');
    syncTalks(demo);
    expect(openContainer(demo)).toBeNull();
    demo.party.select('kara');
    syncTalks(demo);
    expect(openContainer(demo)).toBe('tobin');
    expect(talkingView(demo)?.held).toBe('Close the shop to go on.');
  });

  it('is broken off by a fight, and the one talking is free to fight', () => {
    const demo = room();
    attackWithSelected(demo, 'tobin');
    demo.party.select('tamsin');
    syncTalks(demo);
    startEncounter(demo, 'raid');
    syncTalks(demo);
    expect(talkingAside(demo)).toEqual([]);
    expect(demo.party.isHeld('kara')).toBe(false);
    expect(demo.log.some((line) => line.text === 'Kara breaks off the conversation.')).toBe(true);
    demo.party.select('kara');
    syncTalks(demo);
    expect(demo.pending).toBeNull();
  });

  it('holds up saving and resting while it waits', () => {
    const demo = room();
    attackWithSelected(demo, 'tobin');
    demo.party.select('tamsin');
    syncTalks(demo);
    expect(saveBlockedBy(demo)).toBe('Not in the middle of a conversation.');
    expect(rest(demo, 'short', { moves: {} })).toEqual({ ok: false, reason: 'not in the middle of a conversation' });
  });

  it('is the one who used the thing that opened it, as well as the one who spoke', () => {
    const demo = room();
    approachThenUse(demo, 'stone');
    expect(scriptPending(demo)?.dialogue?.by).toBe('kara');
    demo.party.select('tamsin');
    syncTalks(demo);
    expect(talkingAside(demo)).toEqual(['kara']);
  });

  it('is over, without a word, when a save is loaded over it', () => {
    const demo = room();
    const save = saveGame(demo)!;
    attackWithSelected(demo, 'tobin');
    demo.party.select('tamsin');
    syncTalks(demo);
    const logged = demo.log.length;
    expect(loadGame(demo, save).ok).toBe(true);
    syncTalks(demo);
    expect(talkingAside(demo)).toEqual([]);
    expect(demo.log.length).toBeLessThanOrEqual(logged);
    demo.party.select('kara');
    syncTalks(demo);
    expect(demo.pending).toBeNull();
    expect(demo.party.canCommand('kara')).toBe(true);
  });
});
