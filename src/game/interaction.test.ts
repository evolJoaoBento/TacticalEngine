/**
 * Creatures that can be talked to (`game/interaction.ts`): a friendly one talks when clicked and
 * can be talked into a fight; a threshold one stops the fight when a blow leaves it low enough,
 * talks, and stays whatever the conversation leaves it - once.
 */

import { describe, it, expect } from 'vitest';
import { blankScene } from '../engine/scene/grid-from-scene';
import { encounterSchema, projectSchema, sceneSchema, type AdversaryInteraction } from '../engine/scene/schema';
import { blankSheet } from '../engine/character/sheet';
import { characterSheetSchema } from '../engine/character/sheet-schema';
import { dialogueSchema } from '../engine/dialogue/schema';
import { EditorSession, addAdversary, addDialogue, addEncounter, addSheet, setSpawns, toggleTriggerCell } from '../editor/session';
import { FIXTURE_ADVERSARIES, FIXTURE_FOE } from '../../tests/fixtures/adversaries';
import { answerPending, attackWithSelected, buildProjectScene, moveSelectedTo, settleFight, type DemoScene } from './demo-scene';
import { scriptPending } from './moment';
import { startEncounter } from './movement';
import { tileOf } from '../engine/scene/grid-from-scene';

const KARA = characterSheetSchema.parse(
  blankSheet('kara', 'sentinel', { name: 'Kara', ancestryId: 'human', armorId: 'ringmail', primaryWeaponId: 'longsword', subclassId: 'shieldbearer' }),
);

/** Mercy asked for: spare them and the talk ends; finish it and a consequence turns them back. */
const PARLEY = dialogueSchema.parse({
  id: 'parley',
  start: 'plead',
  nodes: [
    { id: 'plead', lines: [{ speaker: 'Foe', text: 'Mercy!' }], choices: [{ text: 'Spare them', goto: 'spared' }, { text: 'Finish it', goto: 'turn' }] },
    { id: 'spared', lines: [{ text: 'They lower their blade.' }] },
    { id: 'turn', kind: 'consequence', onEnter: [{ kind: 'setAttitude', attitude: 'hostile' }] },
  ],
});

/** A room with Kara, and the foe four tiles off, which a step at 3,4 wakes. */
function room(interaction: AdversaryInteraction, others: string[] = []): DemoScene {
  const s = new EditorSession(
    projectSchema.parse({
      id: 'talk',
      name: 'Talk',
      scenes: [sceneSchema.parse({ ...blankScene('hall', 12, 8), spawns: [{ x: 1, y: 4 }] })],
      startScene: 'hall',
    }),
  );
  s.project.adversaries.push(...FIXTURE_ADVERSARIES);
  s.run(addSheet(KARA));
  s.run(addDialogue(PARLEY));
  s.run(setSpawns('hall', [{ x: 1, y: 4 }]));
  s.run(addEncounter('hall', encounterSchema.parse({ id: 'ambush', name: 'An ambush' })));
  s.run(addAdversary('hall', 'ambush', { id: 'foe', adversary: FIXTURE_FOE, position: { x: 5, y: 4 }, hitPoints: 4, interaction }));
  others.forEach((id, i) => s.run(addAdversary('hall', 'ambush', { id, adversary: FIXTURE_FOE, position: { x: 8, y: 2 + i * 3 } })));
  s.run(toggleTriggerCell('hall', 'ambush', { x: 3, y: 4 }));
  const demo = buildProjectScene(s.project, 'parley');
  demo.askDefender = false;
  return demo;
}

const talking = (demo: DemoScene): string[] => scriptPending(demo)?.dialogue?.view?.lines.map((line) => line.text) ?? [];
/** Pick a reply by what it says, then walk on through whatever is said after it. */
function reply(demo: DemoScene, text: string): void {
  const view = scriptPending(demo)!.dialogue!.view!;
  answerPending(demo, { kind: 'choose', index: view.options.find((o) => o.text === text)!.index });
  for (let i = 0; i < 5 && demo.pending !== null; i++) answerPending(demo, { kind: 'continue' });
}
/** A wound that leaves it with this many Hit Points, answered as a blow's would be. */
function woundTo(demo: DemoScene, id: string, left: number): void {
  const pool = demo.state.entity(id)!.hitPoints;
  pool.marked = pool.max - left;
  settleFight(demo);
}

describe('a friendly creature', () => {
  it('stands on nobody\'s side, and the step that would have woken it wakes nothing', () => {
    const demo = room({ kind: 'friendly', dialogue: 'parley' });
    expect(demo.state.entity('foe')!.faction).toBe('neutral');
    moveSelectedTo(demo, tileOf(demo.grid, { x: 3, y: 4 }));
    expect(demo.encounter).toBeNull();
  });

  it('is talked to rather than struck, and a consequence turns it hostile and starts its fight', () => {
    const demo = room({ kind: 'friendly', dialogue: 'parley' });
    const result = attackWithSelected(demo, 'foe');
    expect(result?.waiting).toBe(true);
    expect(demo.state.entity('foe')!.hitPoints.marked).toBe(0);
    expect(talking(demo)).toEqual(['Mercy!']);
    reply(demo, 'Finish it');
    expect(demo.pending).toBeNull();
    expect(demo.state.entity('foe')!.faction).toBe('adversary');
    expect(demo.encounter?.outcome).toBe('ongoing');
    expect(demo.log.some((line) => line.text.includes('turns on the party'))).toBe(true);
  });

  it('stays friendly when the conversation says nothing of it, and talks again when clicked again', () => {
    const demo = room({ kind: 'friendly', dialogue: 'parley' });
    attackWithSelected(demo, 'foe');
    reply(demo, 'Spare them');
    expect(demo.state.entity('foe')!.faction).toBe('neutral');
    expect(demo.encounter).toBeNull();
    attackWithSelected(demo, 'foe');
    expect(talking(demo)).toEqual(['Mercy!']);
  });
});

describe('a creature with a threshold', () => {
  it('fights until a blow leaves it at its share, then turns friendly and talks while the fight holds', () => {
    const demo = room({ kind: 'threshold', dialogue: 'parley', percent: 50 }, ['other']);
    startEncounter(demo, 'ambush');
    expect(demo.state.entity('foe')!.faction).toBe('adversary');
    // Three of four left is above half: nothing.
    woundTo(demo, 'foe', 3);
    expect(demo.pending).toBeNull();
    // Two of four is half: it stops.
    woundTo(demo, 'foe', 2);
    expect(demo.state.entity('foe')!.faction).toBe('neutral');
    expect(talking(demo)).toEqual(['Mercy!']);
    expect(demo.encounter!.outcome).toBe('ongoing');
    // The fight holds: nobody takes a turn while the conversation is open.
    expect(demo.gmTurn).toBeNull();
    reply(demo, 'Spare them');
    // Someone else still wants the fight, so it goes on without the one who was spared.
    expect(demo.encounter!.outcome).toBe('ongoing');
    expect(demo.state.entitiesOf('adversary').map((e) => e.id)).toEqual(['other']);
  });

  it("stops a GM's turn in the middle, and the turn plays on once the conversation is over", () => {
    const demo = room({ kind: 'threshold', dialogue: 'parley', percent: 50 }, ['other']);
    startEncounter(demo, 'ambush');
    demo.encounter!.passToGm();
    // Half-way through the GM's turn: 'other' still to act when the wound lands.
    demo.gmTurn = { remaining: ['other'], acted: 0, spotlights: {}, features: {}, granted: new Set(), halved: new Set() };
    woundTo(demo, 'foe', 2);
    expect(talking(demo)).toEqual(['Mercy!']);
    expect(demo.gmTurn).not.toBeNull();
    reply(demo, 'Spare them');
    // The rest of the turn was played and the spotlight came back, rather than the fight waiting forever.
    expect(demo.pending).toBeNull();
    expect(demo.gmTurn).toBeNull();
    expect(demo.encounter!.view().side).toBe('party');
  });

  it('ends the fight when the one talked round was the last who wanted it', () => {
    const demo = room({ kind: 'threshold', dialogue: 'parley', percent: 50 });
    startEncounter(demo, 'ambush');
    woundTo(demo, 'foe', 1);
    reply(demo, 'Spare them');
    expect(demo.encounter!.outcome).toBe('victory');
    expect(demo.log.some((line) => line.text === 'Nobody is left who wants a fight. It is over.')).toBe(true);
  });

  it('can be talked back into the fight, and does not stop to talk a second time', () => {
    const demo = room({ kind: 'threshold', dialogue: 'parley', percent: 50 });
    startEncounter(demo, 'ambush');
    woundTo(demo, 'foe', 2);
    reply(demo, 'Finish it');
    const foe = demo.state.entity('foe')!;
    expect(foe.faction).toBe('adversary');
    expect(foe.interacted).toBe(true);
    expect(demo.encounter!.outcome).toBe('ongoing');
    woundTo(demo, 'foe', 1);
    expect(demo.pending).toBeNull();
    expect(foe.faction).toBe('adversary');
  });

  it('is defeated, not talked round, by a blow that kills it', () => {
    const demo = room({ kind: 'threshold', dialogue: 'parley', percent: 50 });
    startEncounter(demo, 'ambush');
    const foe = demo.state.entity('foe')!;
    foe.hitPoints.marked = foe.hitPoints.max;
    foe.alive = false;
    settleFight(demo);
    expect(demo.pending).toBeNull();
    expect(demo.encounter!.outcome).toBe('victory');
  });

  it('remembers across a save that it has already talked', () => {
    const demo = room({ kind: 'threshold', dialogue: 'parley', percent: 50 });
    startEncounter(demo, 'ambush');
    woundTo(demo, 'foe', 2);
    reply(demo, 'Finish it');
    const snapshot = JSON.parse(JSON.stringify(demo.state.snapshot()));
    demo.state.restore(snapshot);
    expect(demo.state.entity('foe')!.interacted).toBe(true);
    expect(demo.state.entity('foe')!.faction).toBe('adversary');
  });
});
