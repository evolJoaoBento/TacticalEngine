/**
 * Authoring interactions: a creature's setting as one undoable edit, a prop that opens a
 * conversation, and what Check says about either when it points nowhere.
 */

import { describe, it, expect } from 'vitest';
import { blankScene } from '../engine/scene/grid-from-scene';
import { encounterSchema, projectSchema, sceneSchema } from '../engine/scene/schema';
import { dialogueSchema } from '../engine/dialogue/schema';
import { PROP_FUNCTIONS, objectOfProp } from '../engine/scene/prop-functions';
import { EditorSession, addAdversary, addDeco, addDialogue, addEncounter } from './session';
import { setCreatureInteraction } from './creature-edits';
import { validateProject } from './validate';

function session(): EditorSession {
  const s = new EditorSession(
    projectSchema.parse({
      id: 'p',
      name: 'P',
      scenes: [sceneSchema.parse({ ...blankScene('hall', 8, 6), spawns: [{ x: 1, y: 1 }] })],
      startScene: 'hall',
    }),
  );
  s.run(addDialogue(dialogueSchema.parse({ id: 'parley', start: 'a', nodes: [{ id: 'a', lines: [{ text: 'Hold.' }] }] })));
  s.run(addEncounter('hall', encounterSchema.parse({ id: 'fight' })));
  s.run(addAdversary('hall', 'fight', { id: 'foe', adversary: 'fixture-foe', position: { x: 4, y: 3 } }));
  return s;
}

const placement = (s: EditorSession) => s.project.scenes[0]!.encounters[0]!.adversaries[0]!;
const messages = (s: EditorSession): string[] => validateProject(s.project).map((p) => p.message);

describe("a creature's interaction", () => {
  it('is set whole and taken away whole, one undo step each', () => {
    const s = session();
    s.run(setCreatureInteraction('hall', 'fight', 'foe', { kind: 'threshold', dialogue: 'parley', percent: 30 }));
    expect(placement(s).interaction).toEqual({ kind: 'threshold', dialogue: 'parley', percent: 30 });
    s.run(setCreatureInteraction('hall', 'fight', 'foe', null));
    expect(placement(s).interaction).toBeUndefined();
    s.undo();
    expect(placement(s).interaction).toEqual({ kind: 'threshold', dialogue: 'parley', percent: 30 });
    s.undo();
    expect(placement(s).interaction).toBeUndefined();
  });

  it('is an error when it names a conversation the project does not have', () => {
    const s = session();
    s.run(setCreatureInteraction('hall', 'fight', 'foe', { kind: 'friendly', dialogue: 'gone' }));
    expect(messages(s)).toContain('"foe" talks with conversation "gone", which does not exist.');
  });
});

describe('an interaction prop', () => {
  it('opens its conversation when used, and nothing while none is picked', () => {
    expect(objectOfProp({ id: 'shrine', model: 'pillar', position: { x: 1, y: 1 }, rotation: 0, function: { kind: 'interaction', dialogue: 'parley' } }).effects)
      .toEqual([{ kind: 'startDialogue', dialogue: 'parley' }]);
    expect(PROP_FUNCTIONS.interaction.fresh()).toEqual({ kind: 'interaction', dialogue: '' });
    expect(objectOfProp({ id: 'shrine', model: 'pillar', position: { x: 1, y: 1 }, rotation: 0, function: { kind: 'interaction', dialogue: '' } }).effects).toEqual([]);
  });

  it('is warned about with no conversation, and an error with a missing one', () => {
    const s = session();
    s.run(addDeco('hall', { id: 'shrine', model: 'pillar', position: { x: 2, y: 2 }, rotation: 0, function: { kind: 'interaction', dialogue: '' } }));
    s.run(addDeco('hall', { id: 'altar', model: 'pillar', position: { x: 5, y: 2 }, rotation: 0, function: { kind: 'interaction', dialogue: 'gone' } }));
    const said = messages(s);
    expect(said).toContain('"shrine" is an interaction with no conversation picked, so using it says nothing.');
    expect(said).toContain('"altar" starts conversation "gone", which does not exist.');
  });
});

describe('a consequence node', () => {
  it('is warned about when it does nothing', () => {
    const s = session();
    s.run(addDialogue(dialogueSchema.parse({ id: 'empty', start: 'a', nodes: [{ id: 'a', lines: [{ text: 'Hm.' }], goto: 'c' }, { id: 'c', kind: 'consequence' }] })));
    expect(messages(s)).toContain('Conversation "empty" has a consequence that does nothing: "c".');
  });
});
