import { describe, it, expect } from 'vitest';
import { blankScene } from '../engine/scene/grid-from-scene';
import { encounterSchema, projectSchema, sceneSchema } from '../engine/scene/schema';
import { EditorSession } from './session';
import { moveAdversary } from './creature-edits';

function session(): EditorSession {
  const scene = sceneSchema.parse({
    ...blankScene('room', 8, 6),
    encounters: [encounterSchema.parse({ id: 'fight', adversaries: [{ id: 'cutter', adversary: 'bandit-cutter', position: { x: 2, y: 2 } }] })],
  });
  return new EditorSession(projectSchema.parse({ id: 'demo', name: 'Demo', scenes: [scene], startScene: 'room' }));
}

const at = (s: EditorSession) => s.project.scenes[0]!.encounters[0]!.adversaries[0]!.position;

describe('moving a placed creature', () => {
  it('puts it on the new tile, and undo puts it back', () => {
    const s = session();
    expect(s.run(moveAdversary('room', 'fight', 'cutter', { x: 5, y: 3 }))).toBe(true);
    expect(at(s)).toEqual({ x: 5, y: 3 });
    s.undo();
    expect(at(s)).toEqual({ x: 2, y: 2 });
  });

  it('makes a whole carry one step, back to where it was picked up', () => {
    const s = session();
    for (const x of [3, 4, 5, 6]) s.run(moveAdversary('room', 'fight', 'cutter', { x, y: 2, ...(x === 6 ? { z: 1 } : {}) }));
    expect(at(s)).toEqual({ x: 6, y: 2, z: 1 });
    s.undo();
    expect(at(s)).toEqual({ x: 2, y: 2 });
    expect(s.canUndo).toBe(false);
    s.redo();
    expect(at(s)).toEqual({ x: 6, y: 2, z: 1 });
  });

  it('changes nothing for a creature that is not there, or a move to where it stands', () => {
    const s = session();
    expect(s.run(moveAdversary('room', 'fight', 'nobody', { x: 5, y: 3 }))).toBe(false);
    expect(s.run(moveAdversary('room', 'fight', 'cutter', { x: 2, y: 2 }))).toBe(false);
    expect(s.canUndo).toBe(false);
  });
});
