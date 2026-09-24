/**
 * An interaction that waits for its walk (`game/arrival.ts`): a thing out of reach is used, and
 * somebody out of reach is talked to, only once the walk up to them has ended - and never when the
 * walk was called off on the way. Headless (`animated` false) nothing waits, as before. And out of a
 * fight the rest of the party walks up behind them, as on any other walk.
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
import { attackWithSelected, buildProjectScene, type DemoScene } from './demo-scene';
import { scriptPending } from './moment';
import { openContainer } from './prop-use';
import { approachThenUse, arrived, cancelApproach } from './arrival';

const KARA = characterSheetSchema.parse(
  blankSheet('kara', 'sentinel', { name: 'Kara', ancestryId: 'human', armorId: 'ringmail', primaryWeaponId: 'longsword', subclassId: 'shieldbearer' }),
);

const TAMSIN = characterSheetSchema.parse({ ...KARA, id: 'tamsin', name: 'Tamsin' });

/** Kara at 1,4; a chest two tiles off, and somebody to talk to three tiles off. The walk is drawn. */
function room(animated = true, party = [KARA]): DemoScene {
  const s = new EditorSession(
    projectSchema.parse({ id: 'a', name: 'A', scenes: [sceneSchema.parse({ ...blankScene('hall', 12, 8), spawns: [{ x: 1, y: 4 }] })], startScene: 'hall' }),
  );
  s.project.adversaries.push(...FIXTURE_ADVERSARIES);
  for (const sheet of party) s.run(addSheet(sheet));
  s.run(setSpawns('hall', party.map((_, i) => ({ x: 1, y: 4 + i }))));
  s.run(addItem(itemSchema.parse({ id: 'coin', name: 'A coin', kind: 'trinket' })));
  s.run(addDialogue(dialogueSchema.parse({ id: 'hello', start: 'a', nodes: [{ id: 'a', lines: [{ text: 'Well met.' }] }] })));
  s.run(addEncounter('hall', encounterSchema.parse({ id: 'e', startsOnTrigger: false })));
  s.run(addAdversary('hall', 'e', { id: 'friend', adversary: FIXTURE_FOE, position: { x: 4, y: 4 }, interaction: { kind: 'friendly', dialogue: 'hello' } }));
  s.run(addDeco('hall', { id: 'chest', model: 'chest-prop', position: { x: 1, y: 1 }, rotation: 0, function: { kind: 'container', items: [{ item: 'coin', count: 1 }] } }));
  const demo = buildProjectScene(s.project, 'arrival');
  demo.animated = animated;
  return demo;
}

describe('a thing out of reach', () => {
  it('is walked up to, and used only once the walk has ended', () => {
    const demo = room();
    expect(approachThenUse(demo, 'chest')).toBe('walking');
    // On the way: nothing opened yet.
    expect(openContainer(demo)).toBeNull();
    expect(demo.approaching).toEqual({ kind: 'use', id: 'chest', who: 'kara' });
    expect(arrived(demo)).toBe(true);
    expect(openContainer(demo)).toBe('chest');
    expect(demo.approaching).toBeNull();
  });

  it('is never used when the walk is called off on the way', () => {
    const demo = room();
    approachThenUse(demo, 'chest');
    expect(cancelApproach(demo)).toBe(true);
    expect(arrived(demo)).toBe(false);
    expect(openContainer(demo)).toBeNull();
  });

  it('is used at once with no walk to watch, as it always was', () => {
    const demo = room(false);
    approachThenUse(demo, 'chest');
    expect(openContainer(demo)).toBe('chest');
    expect(demo.approaching).toBeNull();
  });
});

describe('somebody to talk to, out of reach', () => {
  it('is walked up to, and the conversation opens only once the walk has ended', () => {
    const demo = room();
    attackWithSelected(demo, 'friend');
    expect(demo.pending).toBeNull();
    expect(demo.approaching).toEqual({ kind: 'talk', id: 'friend', who: 'kara' });
    arrived(demo);
    expect(scriptPending(demo)?.dialogue?.view?.lines.map((line) => line.text)).toEqual(['Well met.']);
  });

  it('is not talked to when the walk is called off, or the one walking is given another order', () => {
    const demo = room();
    attackWithSelected(demo, 'friend');
    cancelApproach(demo);
    arrived(demo);
    expect(demo.pending).toBeNull();

    const other = room();
    attackWithSelected(other, 'friend');
    // Walked for by somebody who is no longer the one selected: what the walk was for does not outlive it.
    other.approaching = { ...other.approaching!, who: 'someone-else' };
    expect(arrived(other)).toBe(false);
    expect(other.pending).toBeNull();
  });
});

describe('the rest of the party', () => {
  it('walks up behind whoever goes to talk, or to use a thing, out of a fight', () => {
    const demo = room(true, [KARA, TAMSIN]);
    demo.party.select('kara');
    const before = demo.state.entity('tamsin')!.tile;
    attackWithSelected(demo, 'friend');
    expect(demo.motions.map((motion) => motion.id)).toEqual(['kara', 'tamsin']);
    expect(demo.state.entity('tamsin')!.tile).not.toBe(before);

    const other = room(true, [KARA, TAMSIN]);
    other.party.select('kara');
    approachThenUse(other, 'chest');
    expect(other.motions.map((motion) => motion.id)).toEqual(['kara', 'tamsin']);
  });
});
