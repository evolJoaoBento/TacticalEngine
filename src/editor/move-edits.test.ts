import { describe, it, expect } from 'vitest';
import { blankScene } from '../engine/scene/grid-from-scene';
import { encounterSchema, interactableSchema, projectSchema, sceneSchema } from '../engine/scene/schema';
import { EditorSession } from './session';
import { moveAdversary, moveDeco, moveInteractable, moveSpawn } from './move-edits';

function session(): EditorSession {
  const scene = sceneSchema.parse({
    ...blankScene('room', 8, 6),
    encounters: [encounterSchema.parse({ id: 'fight', adversaries: [{ id: 'cutter', adversary: 'bandit-cutter', position: { x: 2, y: 2 } }] })],
    decos: [{ model: 'crate', position: { x: 1, y: 1 }, rotation: 0 }, { model: 'barrel', position: { x: 1, y: 1 }, rotation: 1 }],
    interactables: [interactableSchema.parse({ id: 'chest', kind: 'chest', position: { x: 4, y: 4 } })],
    spawns: [{ x: 0, y: 0 }, { x: 0, y: 1 }],
  });
  return new EditorSession(projectSchema.parse({ id: 'demo', name: 'Demo', scenes: [scene], startScene: 'room' }));
}

const room = (s: EditorSession) => s.project.scenes[0]!;
const creatureAt = (s: EditorSession) => room(s).encounters[0]!.adversaries[0]!.position;

describe('moving a placed creature', () => {
  it('puts it on the new tile, and undo puts it back', () => {
    const s = session();
    expect(s.run(moveAdversary('room', 'fight', 'cutter', { x: 5, y: 3 }))).toBe(true);
    expect(creatureAt(s)).toEqual({ x: 5, y: 3 });
    s.undo();
    expect(creatureAt(s)).toEqual({ x: 2, y: 2 });
  });

  it('keeps the Z it was carried to, through an undo and a redo', () => {
    const s = session();
    s.run(moveAdversary('room', 'fight', 'cutter', { x: 6, y: 2, z: 1 }));
    expect(creatureAt(s)).toEqual({ x: 6, y: 2, z: 1 });
    s.undo();
    expect(creatureAt(s)).toEqual({ x: 2, y: 2 });
    expect(s.canUndo).toBe(false);
    s.redo();
    expect(creatureAt(s)).toEqual({ x: 6, y: 2, z: 1 });
  });

  it('changes nothing for a creature that is not there, or a move to where it stands', () => {
    const s = session();
    expect(s.run(moveAdversary('room', 'fight', 'nobody', { x: 5, y: 3 }))).toBe(false);
    expect(s.run(moveAdversary('room', 'fight', 'cutter', { x: 2, y: 2 }))).toBe(false);
    expect(s.canUndo).toBe(false);
  });
});

describe('moving props, objects and party starts', () => {
  it('moves the prop it is given by place, leaving the one under it', () => {
    const s = session();
    expect(s.run(moveDeco('room', 1, { x: 3, y: 1, z: 0.5 }))).toBe(true);
    expect(room(s).decos.map((d) => [d.model, d.position])).toEqual([
      ['crate', { x: 1, y: 1 }],
      ['barrel', { x: 3, y: 1, z: 0.5 }],
    ]);
    s.undo();
    expect(room(s).decos[1]!.position).toEqual({ x: 1, y: 1 });
  });

  it('moves an object, and undo puts it back', () => {
    const s = session();
    expect(s.run(moveInteractable('room', 'chest', { x: 6, y: 5 }))).toBe(true);
    expect(room(s).interactables[0]!.position).toEqual({ x: 6, y: 5 });
    s.undo();
    expect(room(s).interactables[0]!.position).toEqual({ x: 4, y: 4 });
  });

  it('moves a party start without a Z, and undo puts it back', () => {
    const s = session();
    expect(s.run(moveSpawn('room', 1, { x: 3, y: 4, z: 2 }))).toBe(true);
    expect(room(s).spawns).toEqual([{ x: 0, y: 0 }, { x: 3, y: 4 }]);
    s.undo();
    expect(room(s).spawns).toEqual([{ x: 0, y: 0 }, { x: 0, y: 1 }]);
  });

  it('turns a prop where it stands: a facing is a change, though the tile is not', () => {
    const s = session();
    const at = { ...room(s).decos[1]!.position };
    expect(s.run(moveDeco('room', 1, at, Math.PI / 2))).toBe(true);
    expect(room(s).decos[1]!.rotation).toBeCloseTo(Math.PI / 2);
    expect(room(s).decos[1]!.position).toEqual(at);

    // One step, and it takes the facing back with the place.
    s.undo();
    expect(room(s).decos[1]!.rotation).toBeCloseTo(1);
    expect(room(s).decos[1]!.position).toEqual(at);

    // Carried without being turned, it keeps the facing it had.
    expect(s.run(moveDeco('room', 1, { x: 4, y: 2 }))).toBe(true);
    expect(room(s).decos[1]!.rotation).toBeCloseTo(1);
  });

  it('turns an object where it hangs: a door in its own doorway is still an edit', () => {
    const s = session();
    const at = { ...room(s).interactables[0]!.position };
    expect(s.run(moveInteractable('room', 'chest', at, Math.PI / 2))).toBe(true);
    expect(room(s).interactables[0]!.rotation).toBeCloseTo(Math.PI / 2);
    expect(room(s).interactables[0]!.position).toEqual(at);

    // One step, and the facing goes back with the place.
    s.undo();
    expect(room(s).interactables[0]!.rotation).toBeCloseTo(0);

    // Moved without being turned, it keeps the facing it had.
    expect(s.run(moveInteractable('room', 'chest', { x: 6, y: 5 }))).toBe(true);
    expect(room(s).interactables[0]!.rotation).toBeCloseTo(0);
  });

  it('changes nothing for a thing that is not there, or one put back where it stood', () => {
    const s = session();
    expect(s.run(moveDeco('room', 7, { x: 3, y: 1 }))).toBe(false);
    expect(s.run(moveInteractable('room', 'nothing', { x: 3, y: 1 }))).toBe(false);
    expect(s.run(moveSpawn('room', 0, { x: 0, y: 0 }))).toBe(false);
    expect(s.canUndo).toBe(false);
  });
});
