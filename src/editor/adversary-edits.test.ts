/**
 * The project's own creatures (`adversary-edits.ts`): copied from one that is there, changed, and
 * taken out, each an undo step - and a creature of the project's own is one the room can be played with.
 */

import { describe, it, expect } from 'vitest';
import { blankScene } from '../engine/scene/grid-from-scene';
import { projectSchema, sceneSchema, type ProjectDoc } from '../engine/scene/schema';
import { adversaryDefSchema } from '../engine/content/pack/schema';
import { adversaryDefsFor } from '../game/room';
import { EditorSession } from './session';
import { addAdversaryDef, copyOfAdversary, removeAdversaryDef, updateAdversaryDef, type ProjectAdversary } from './adversary-edits';
import { FIXTURE_ADVERSARIES } from '../../tests/fixtures/adversaries';

function project(): ProjectDoc {
  return projectSchema.parse({ id: 'demo', name: 'Demo', scenes: [sceneSchema.parse(blankScene('room', 6, 4))], startScene: 'room' });
}

const foe = (): ProjectAdversary => structuredClone(FIXTURE_ADVERSARIES[0]!) as ProjectAdversary;

describe('a creature copied as a new one', () => {
  it('has a free id beside the original and its name marked, and is otherwise the same stat block', () => {
    const original = foe();
    const copy = copyOfAdversary(original, new Set([original.id]));
    expect(copy.id).toBe(`${original.id}-copy`);
    expect(copy.name).toBe(`${original.name} (copy)`);
    expect({ ...copy, id: original.id, name: original.name }).toEqual(original);
    expect(copyOfAdversary(original, new Set([original.id, `${original.id}-copy`])).id).toBe(`${original.id}-copy-2`);
    // A copy, not the same object: changing it leaves the original alone.
    copy.thresholds.major = 99;
    expect(original.thresholds.major).not.toBe(99);
    expect(adversaryDefSchema.safeParse(copy).success).toBe(true);
  });

  it('is added with the model it is drawn with, one undo taking both away, and is a creature the room knows', () => {
    const session = new EditorSession(project());
    const copy = copyOfAdversary(foe(), new Set());
    session.run(addAdversaryDef(copy, 'bandit-cutter'));
    expect(session.project.adversaries.map((def) => def.id)).toEqual([copy.id]);
    expect(session.project.adversaryModels[copy.id]).toBe('bandit-cutter');
    expect(adversaryDefsFor(session.project).get(copy.id)?.name).toBe(copy.name);
    session.undo();
    expect(session.project.adversaries).toEqual([]);
    expect(session.project.adversaryModels[copy.id]).toBeUndefined();
  });
});

describe('a creature of the project’s own, changed', () => {
  it('takes the change, and typing a name is one undo step, back to what it was', () => {
    const session = new EditorSession(project());
    const copy = copyOfAdversary(foe(), new Set());
    session.run(addAdversaryDef(copy));
    for (const name of ['G', 'Gr', 'Gru', 'Grub']) session.run(updateAdversaryDef(copy.id, { name }));
    session.run(updateAdversaryDef(copy.id, { hitPoints: 9, thresholds: { major: 4, severe: 8 } }));
    const now = session.project.adversaries[0]!;
    expect(now.name).toBe('Grub');
    expect(now.hitPoints).toBe(9);
    expect(now.thresholds).toEqual({ major: 4, severe: 8 });
    session.undo();
    expect(session.project.adversaries[0]!.hitPoints).toBe(copy.hitPoints);
    expect(session.project.adversaries[0]!.name).toBe('Grub');
    session.undo();
    expect(session.project.adversaries[0]!.name).toBe(copy.name);
  });

  it('is taken out, and put back where it was by undo', () => {
    const session = new EditorSession(project());
    const [a, b] = [copyOfAdversary(foe(), new Set()), copyOfAdversary(foe(), new Set([`${foe().id}-copy`]))];
    session.run(addAdversaryDef(a!));
    session.run(addAdversaryDef(b!));
    session.run(removeAdversaryDef(a!.id));
    expect(session.project.adversaries.map((def) => def.id)).toEqual([b!.id]);
    session.undo();
    expect(session.project.adversaries.map((def) => def.id)).toEqual([a!.id, b!.id]);
  });
});
