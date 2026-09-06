import { describe, it, expect } from 'vitest';
import { questSchema } from '../engine/content/quests';
import { blankScene } from '../engine/scene/grid-from-scene';
import { projectSchema, sceneSchema, type ProjectDoc } from '../engine/scene/schema';
import {
  EditorSession,
  addObjective,
  addQuest,
  removeObjective,
  removeQuest,
  updateObjective,
  updateQuest,
} from './session';

/**
 * Editing a quest as a document. The form is a view over these; every keystroke
 * is one of them, coalesced by field, which is what makes it undoable.
 */

const WORD = {
  id: 'word',
  name: 'The word',
  summary: 'Ask nicely.',
  objectives: [
    { id: 'ask', text: 'Ask.' },
    { id: 'open', text: 'Open it.' },
  ],
};

function project(): ProjectDoc {
  return projectSchema.parse({
    id: 'demo',
    name: 'Demo',
    scenes: [sceneSchema.parse(blankScene('room', 6, 4))],
    quests: [questSchema.parse(WORD)],
    startScene: 'room',
  });
}

const session = (): EditorSession => new EditorSession(project());
const word = (s: EditorSession) => s.project.quests[0]!;

describe('quests in the project', () => {
  it('adds and removes one, putting it back in place', () => {
    const s = session();
    s.run(addQuest(questSchema.parse({ ...WORD, id: 'other' })));
    expect(s.project.quests.map((q) => q.id)).toEqual(['word', 'other']);

    expect(s.run(removeQuest('word'))).toBe(true);
    expect(s.project.quests.map((q) => q.id)).toEqual(['other']);
    s.undo();
    expect(s.project.quests.map((q) => q.id)).toEqual(['word', 'other']);
  });

  it('removing a quest that is not there is a no-op, not an undo step', () => {
    const s = session();
    expect(s.run(removeQuest('nope'))).toBe(false);
  });

  it('renames with keystrokes coalesced into one undo', () => {
    const s = session();
    s.run(updateQuest('word', { name: 'T' }));
    s.run(updateQuest('word', { name: 'Th' }));
    s.run(updateQuest('word', { name: 'The' }));
    expect(word(s).name).toBe('The');
    s.undo();
    expect(word(s).name).toBe('The word');
    // The summary is a different field, so it is a different undo step.
    s.run(updateQuest('word', { summary: 'x' }));
    s.run(updateQuest('word', { name: 'y' }));
    s.undo();
    expect(word(s).name).toBe('The word');
    expect(word(s).summary).toBe('x');
  });

  it('survives a round trip through the schema after every edit', () => {
    const s = session();
    s.run(updateQuest('word', { name: 'Renamed' }));
    s.run(addObjective('word', { id: 'bring', text: 'Bring it back.' }));
    expect(() => projectSchema.parse(JSON.parse(JSON.stringify(s.project)))).not.toThrow();
  });
});

describe('objectives', () => {
  it('adds a step at the end, and undoes it', () => {
    const s = session();
    s.run(addObjective('word', { id: 'bring', text: 'Bring it back.' }));
    expect(word(s).objectives.map((o) => o.id)).toEqual(['ask', 'open', 'bring']);
    s.undo();
    expect(word(s).objectives.map((o) => o.id)).toEqual(['ask', 'open']);
  });

  it('removes a step and puts it back where it was', () => {
    const s = session();
    expect(s.run(removeObjective('word', 0))).toBe(true);
    expect(word(s).objectives.map((o) => o.id)).toEqual(['open']);
    s.undo();
    expect(word(s).objectives.map((o) => o.id)).toEqual(['ask', 'open']);
  });

  it('keeps at least one step', () => {
    const s = session();
    s.run(removeObjective('word', 0));
    expect(s.run(removeObjective('word', 0))).toBe(false);
    expect(word(s).objectives).toHaveLength(1);
  });

  it('rewrites a step with keystrokes coalesced', () => {
    const s = session();
    s.run(updateObjective('word', 1, { text: 'O' }));
    s.run(updateObjective('word', 1, { text: 'Op' }));
    expect(word(s).objectives[1]!.text).toBe('Op');
    expect(word(s).objectives[0]!.text).toBe('Ask.');
    s.undo();
    expect(word(s).objectives[1]!.text).toBe('Open it.');
  });

  it('does not alias the original objective when editing', () => {
    const before = project();
    const s = new EditorSession(before);
    const original = word(s).objectives[0]!;
    s.run(updateObjective('word', 0, { text: 'Changed.' }));
    expect(original.text).toBe('Ask.');
  });
});
