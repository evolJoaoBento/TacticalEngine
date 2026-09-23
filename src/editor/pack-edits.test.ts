import { describe, it, expect } from 'vitest';
import { readPack, type PackDocument } from '../engine/content/pack/document';
import { blankScene } from '../engine/scene/grid-from-scene';
import { projectSchema, sceneSchema, type ProjectDoc } from '../engine/scene/schema';
import { adversaryDefsFor, characterContentFor } from '../game/room';
import { EditorSession, importPack, packChanges } from './session';

/**
 * Importing a pack, as an edit. The door in `main.ts` reads the file; this is what the project
 * becomes, what the game then builds from, and what one Undo gives back.
 */

const RALLY = {
  id: 'rally',
  name: 'Rally',
  source: { card: 'rally' },
  effects: [{ kind: 'log', text: 'Quim shouts.' }],
};

const WRAITH = {
  id: 'glass-wraith',
  name: 'Glass Wraith',
  tier: 1,
  role: 'skulk',
  difficulty: 12,
  thresholds: { major: 6, severe: 11 },
  hitPoints: 4,
  stress: 3,
  attackName: 'Shard',
  attackModifier: { count: 0, sides: 0, modifier: 1 },
  attackRange: 'melee',
  attackDamage: { count: 1, sides: 8, modifier: 1, types: ['magic'] },
};

const WARDEN = { id: 'lantern-warden', name: 'Lantern Warden', startingEvasion: 10, startingHitPoints: 6 };

function project(): ProjectDoc {
  return projectSchema.parse({
    id: 'demo',
    scenes: [sceneSchema.parse(blankScene('room', 6, 4))],
    abilities: [RALLY],
    startScene: 'room',
  });
}

/** A pack that reprints one card the project has, and brings a card, a creature and a class it has not. */
function pack(): PackDocument {
  const reading = readPack({
    abilities: [{ ...RALLY, name: 'Rally, as the pack prints it' }, { ...RALLY, id: 'second-wind', name: 'Second Wind' }],
    adversaries: [WRAITH],
    classes: [WARDEN],
  });
  expect(reading.refused).toBeNull();
  expect(reading.issues).toEqual([]);
  return reading.pack;
}

describe('importing a pack', () => {
  it('adds what is new and replaces what shares an id, in the lists the game already holds', () => {
    const s = new EditorSession(project());
    const held = s.project.abilities;
    expect(packChanges(s.project, pack())).toEqual({ added: 3, replaced: 1 });

    s.run(importPack(pack()));

    // The same array, not a new one: a world built before the import reads it by reference.
    expect(s.project.abilities).toBe(held);
    expect(held.map((a) => a.id)).toEqual(['rally', 'second-wind']);
    expect(held[0]!.name).toBe('Rally, as the pack prints it');
    expect(s.project.adversaries.map((a) => a.id)).toEqual(['glass-wraith']);
    expect(s.project.classes.map((c) => c.id)).toEqual(['lantern-warden']);
  });

  it('is one step, and Undo gives back exactly what was there', () => {
    const s = new EditorSession(project());
    const held = s.project.abilities;
    const before = JSON.stringify(s.project);

    s.run(importPack(pack()));
    expect(s.undo()).toBe(true);

    expect(JSON.stringify(s.project)).toBe(before);
    expect(s.project.abilities).toBe(held);
    expect(s.redo()).toBe(true);
    expect(s.project.classes.map((c) => c.id)).toEqual(['lantern-warden']);
    expect(s.project.abilities.map((a) => a.id)).toEqual(['rally', 'second-wind']);
  });

  it('is what the game builds characters and fights from, laid over the pack it ships', () => {
    const s = new EditorSession(project());
    expect(characterContentFor(s.project).classes.has('lantern-warden')).toBe(false);
    expect(adversaryDefsFor(s.project).has('glass-wraith')).toBe(false);

    s.run(importPack(pack()));

    expect(characterContentFor(s.project).classes.has('lantern-warden')).toBe(true);
    expect(adversaryDefsFor(s.project).has('glass-wraith')).toBe(true);
    // Laid over, not swapped in: the shipped pack's own class is still there to choose.
    expect(characterContentFor(s.project).classes.has('sentinel')).toBe(true);
  });
});
