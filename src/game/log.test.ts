import { describe, it, expect } from 'vitest';
import { STARTER_ADVERSARIES } from '../engine/content/pack/starter';
import { createRng } from '../engine/core/rng';
import { rollDuality } from '../engine/rules/duality';
import { createAdversaryEntity, createPartyEntity, type EntityState, type Faction } from '../engine/scene/state';
import type { JournalEntry } from '../engine/script/runner';
import { writeDown, type Narration } from './log';

/**
 * The narration, written against nine fields and no game.
 *
 * `log.ts` is the one part of `src/game/` a test can drive without standing up
 * a scene, and this is the proof: a board of two, a world that knows two names,
 * an empty project, and the queues a view drains. If `writeDown` ever reaches
 * for anything else, this stops compiling before it stops passing.
 */
function narration(): Narration {
  const everybody: EntityState[] = [
    createPartyEntity('kara', 'warrior', 5, { hitPoints: 6, stress: 6 }),
    createAdversaryEntity('knight-1', 'hollow-knight', 6, { hitPoints: 5, stress: 3 }),
  ];
  return {
    state: {
      entity: (id: string) => everybody.find((e) => e.id === id),
      entitiesOf: (faction: Faction) => everybody.filter((e) => e.faction === faction),
    },
    world: {
      adversaryDef: (definition: string) => STARTER_ADVERSARIES.get(definition),
      conditionName: (condition: string) => (condition === 'hidden' ? 'Hidden' : condition),
    },
    sheets: new Map([['kara', { name: 'Kara' }]]),
    project: { items: [], quests: [] },
    scenario: { actorId: 'kara' },
    log: [],
    floaters: [],
    motions: [],
    rolls: [],
  };
}

const knight = STARTER_ADVERSARIES.get('hollow-knight')!.name;

describe('writing a journal down', () => {
  it('turns a swing into a line, a roll to show, a number over a head and two motions', () => {
    const demo = narration();
    const roll = rollDuality(createRng('swing'), { difficulty: 10 });
    const journal: JournalEntry[] = [
      { kind: 'attack', attacker: 'kara', target: 'knight-1', weapon: 'Broadsword', hit: true, critical: false, hitPointsMarked: 2, roll },
    ];

    const lines = writeDown(demo, journal);

    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe(`Kara hits with the Broadsword: 2 Hit Points on ${knight}.`);
    expect(lines[0]!.tone).toBe('combat');
    // Both names are found on the board, whichever order they were matched in.
    expect(lines[0]!.mentions!.map((m) => m.id).sort()).toEqual(['kara', 'knight-1']);
    expect(demo.log).toEqual(lines);
    expect(demo.rolls).toEqual([{ id: expect.any(Number), who: 'Kara', what: 'Broadsword', roll }]);
    expect(demo.floaters).toEqual([{ id: 'knight-1', text: '-2 HP', tone: 'combat' }]);
    expect(demo.motions).toEqual([{ id: 'kara', lunge: { at: 6 } }, { id: 'knight-1', struck: true }]);
  });

  it('names a condition rather than keying it, and floats it', () => {
    const demo = narration();
    const lines = writeDown(demo, [{ kind: 'condition', id: 'knight-1', condition: 'hidden', applied: true }]);
    expect(lines.map((l) => l.text)).toEqual([`${knight} is Hidden.`]);
    expect(demo.floaters).toEqual([{ id: 'knight-1', text: 'Hidden', tone: 'combat' }]);
  });

  it('writes only what is news, and a shove as a motion', () => {
    const demo = narration();
    const lines = writeDown(demo, [
      { kind: 'flag', flag: 'seen', set: true },
      { kind: 'log', text: 'The door groans.', tone: 'narration' },
      { kind: 'moved', id: 'knight-1', from: 6, to: 8 },
    ]);
    expect(lines.map((l) => l.text)).toEqual(['The door groans.', `${knight} is thrown back.`]);
    expect(demo.motions).toEqual([{ id: 'knight-1', thrown: true }]);
    expect(demo.rolls).toEqual([]);
  });
});
