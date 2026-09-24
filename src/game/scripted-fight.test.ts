/**
 * A script's Start a fight begins the fight (`beginScriptedFights`, `game/movement.ts`), as a trigger
 * cell does: from a prop that is used, from a conversation - but never over a fight already
 * running, and never with nobody in the room to fight. And End a fight stops one: its enemies stand
 * down (`truce`) until the next fight begins, or somebody strikes one of them.
 */

import { describe, it, expect } from 'vitest';
import { blankScene, tileOf } from '../engine/scene/grid-from-scene';
import { encounterSchema, projectSchema, sceneSchema } from '../engine/scene/schema';
import { propFunctionSchema } from '../engine/scene/prop-function-schema';
import { blankSheet } from '../engine/character/sheet';
import { characterSheetSchema } from '../engine/character/sheet-schema';
import { dialogueSchema } from '../engine/dialogue/schema';
import { EditorSession, addAdversary, addDeco, addDialogue, addEncounter, addSheet, setSpawns } from '../editor/session';
import { FIXTURE_ADVERSARIES, FIXTURE_FOE } from '../../tests/fixtures/adversaries';
import { answerPending, attackWithSelected, buildProjectScene, useSelectedOn, type DemoScene } from './demo-scene';
import { inCombat } from './moment';
import { startEncounter } from './movement';

const KARA = characterSheetSchema.parse(
  blankSheet('kara', 'sentinel', { name: 'Kara', ancestryId: 'human', armorId: 'ringmail', primaryWeaponId: 'longsword', subclassId: 'shieldbearer' }),
);
const START = { kind: 'startEncounter' as const, encounter: 'ambush', intro: 'Horns answer from the dark.' };

/** Kara beside a horn that starts the ambush; the ambush's foe waits across the room. */
function room(options: { friendly?: boolean } = {}): DemoScene {
  const s = new EditorSession(
    projectSchema.parse({ id: 'f', name: 'F', scenes: [sceneSchema.parse({ ...blankScene('hall', 12, 8), spawns: [{ x: 1, y: 4 }] })], startScene: 'hall' }),
  );
  s.project.adversaries.push(...FIXTURE_ADVERSARIES);
  s.run(addSheet(KARA));
  s.run(setSpawns('hall', [{ x: 1, y: 4 }]));
  s.run(addDialogue(dialogueSchema.parse({
    id: 'dare',
    start: 'ask',
    nodes: [
      { id: 'ask', lines: [{ text: 'Well?' }], choices: [{ text: 'Sound the horn', goto: 'blow' }] },
      { id: 'blow', kind: 'consequence', onEnter: [START] },
    ],
  })));
  s.run(addEncounter('hall', encounterSchema.parse({ id: 'ambush', startsOnTrigger: false })));
  s.run(addAdversary('hall', 'ambush', {
    id: 'foe', adversary: FIXTURE_FOE, position: { x: 9, y: 4 },
    ...(options.friendly === true ? { interaction: { kind: 'friendly' as const, dialogue: 'dare' } } : {}),
  }));
  s.run(addEncounter('hall', encounterSchema.parse({ id: 'other', startsOnTrigger: false })));
  s.run(addDeco('hall', { id: 'horn', model: 'crate-prop', position: { x: 1, y: 3 }, rotation: 0, function: propFunctionSchema.parse({ kind: 'script', effects: [START], repeatable: true }) }));
  s.run(addDeco('hall', { id: 'flag', model: 'crate-prop', position: { x: 2, y: 3 }, rotation: 0, function: propFunctionSchema.parse({ kind: 'script', effects: [{ kind: 'endEncounter', encounter: 'ambush' }], repeatable: true }) }));
  s.run(addDeco('hall', { id: 'shrine', model: 'crate-prop', position: { x: 2, y: 5 }, rotation: 0, function: { kind: 'interaction', dialogue: 'dare' } }));
  const demo = buildProjectScene(s.project, 'fight');
  demo.askDefender = false;
  return demo;
}

describe('Start a fight', () => {
  it('begins the fight when a prop runs it, the party first, with its intro in the log', () => {
    const demo = room();
    expect(inCombat(demo)).toBe(false);
    useSelectedOn(demo, 'horn');
    expect(inCombat(demo)).toBe(true);
    expect(demo.encounter!.encounterId).toBe('ambush');
    expect(demo.encounter!.view().side).toBe('party');
    expect(demo.log.some((line) => line.text === 'Horns answer from the dark.')).toBe(true);
  });

  it('begins it from a conversation too, once the conversation has had its say', () => {
    const demo = room();
    demo.state.moveEntity('kara', tileOf(demo.grid, { x: 2, y: 4 }));
    useSelectedOn(demo, 'shrine');
    answerPending(demo, { kind: 'choose', index: 0 });
    for (let i = 0; i < 5 && demo.pending !== null; i++) answerPending(demo, { kind: 'continue' });
    expect(demo.pending).toBeNull();
    expect(inCombat(demo)).toBe(true);
    expect(demo.encounter!.encounterId).toBe('ambush');
  });

  it('begins nothing when nobody in the room is hostile', () => {
    const demo = room({ friendly: true });
    useSelectedOn(demo, 'horn');
    expect(inCombat(demo)).toBe(false);
    // Still said: the script ran, it only had nobody to set against the party.
    expect(demo.log.some((line) => line.text === 'Horns answer from the dark.')).toBe(true);
  });

  it('leaves a fight already running as it is', () => {
    const demo = room();
    const running = startEncounter(demo, 'other');
    useSelectedOn(demo, 'horn');
    expect(demo.encounter).toBe(running);
    expect(demo.encounter!.encounterId).toBe('other');
  });
});

describe('End a fight', () => {
  /** A fight begun with the horn, then stopped with the flag of truce. */
  function stopped(): DemoScene {
    const demo = room();
    useSelectedOn(demo, 'horn');
    useSelectedOn(demo, 'flag');
    return demo;
  }

  it('stops the fight, and every enemy standing stands down', () => {
    const demo = stopped();
    expect(inCombat(demo)).toBe(false);
    expect(demo.encounter!.outcome).toBe('stopped');
    const foe = demo.state.entity('foe')!;
    expect(foe.faction).toBe('neutral');
    expect(foe.truce).toBe(true);
    expect(demo.log.some((line) => line.text === 'The fight stops. Nobody raises a weapon.')).toBe(true);
  });

  it('turns them hostile again when a fight begins again', () => {
    const demo = stopped();
    useSelectedOn(demo, 'horn');
    expect(inCombat(demo)).toBe(true);
    const foe = demo.state.entity('foe')!;
    expect(foe.faction).toBe('adversary');
    expect(foe.truce).toBeUndefined();
  });

  it('begins the fight again at a blow struck at one who stood down', () => {
    const demo = stopped();
    attackWithSelected(demo, 'foe');
    expect(inCombat(demo)).toBe(true);
    expect(demo.state.entity('foe')!.faction).toBe('adversary');
  });

  it('leaves a creature friendly by its own interaction friendly, fight or no fight', () => {
    const demo = room({ friendly: true });
    // Nobody hostile, so nothing to stop and nothing stood down.
    useSelectedOn(demo, 'flag');
    expect(demo.state.entity('foe')!.truce).toBeUndefined();
    expect(demo.state.entity('foe')!.faction).toBe('neutral');
  });

  it('keeps who stood down across a save', () => {
    const demo = stopped();
    demo.state.restore(JSON.parse(JSON.stringify(demo.state.snapshot())));
    expect(demo.state.entity('foe')!.truce).toBe(true);
  });
});
