import { describe, it, expect } from 'vitest';
import { dialogueSchema } from '../engine/dialogue/schema';
import { blankScene } from '../engine/scene/grid-from-scene';
import { projectSchema, sceneSchema, type ProjectDoc } from '../engine/scene/schema';
import {
  EditorSession,
  addChoice,
  addDialogue,
  addNode,
  moveNode,
  removeChoice,
  removeDialogue,
  removeNode,
  setDialogueStart,
  updateChoice,
  updateNode,
} from './session';

/**
 * Editing a conversation as a document.
 *
 * The graph canvas is a view over these; every drag, every typed line and every
 * rewired reply is one of them, which is what makes the whole editor undoable.
 */

const TALK = {
  id: 'talk',
  start: 'a',
  nodes: [
    { id: 'a', lines: [{ text: 'Hello.' }], choices: [{ text: 'Hello.', goto: 'b' }] },
    { id: 'b', lines: [{ text: 'Goodbye.' }] },
  ],
};

function project(): ProjectDoc {
  return projectSchema.parse({
    id: 'demo',
    name: 'Demo',
    scenes: [sceneSchema.parse(blankScene('room', 6, 4))],
    dialogues: [dialogueSchema.parse(TALK)],
    startScene: 'room',
  });
}

const session = (): EditorSession => new EditorSession(project());
const talk = (s: EditorSession) => s.project.dialogues[0]!;
const snapshot = (s: EditorSession): string => JSON.stringify(s.project);

describe('conversations in the project', () => {
  it('adds and removes one, putting it back in place', () => {
    const s = session();
    s.run(addDialogue(dialogueSchema.parse({ ...TALK, id: 'other' })));
    expect(s.project.dialogues.map((d) => d.id)).toEqual(['talk', 'other']);

    expect(s.run(removeDialogue('talk'))).toBe(true);
    expect(s.project.dialogues.map((d) => d.id)).toEqual(['other']);
    s.undo();
    expect(s.project.dialogues.map((d) => d.id)).toEqual(['talk', 'other']);
  });

  it('does nothing when asked to remove one that is not there', () => {
    const s = session();
    expect(s.run(removeDialogue('nowhere'))).toBe(false);
  });

  it('chooses which node it opens on, reversibly', () => {
    const s = session();
    expect(s.run(setDialogueStart('talk', 'b'))).toBe(true);
    expect(talk(s).start).toBe('b');
    s.undo();
    expect(talk(s).start).toBe('a');
  });

  it('will not open on a node the conversation does not have', () => {
    const s = session();
    expect(s.run(setDialogueStart('talk', 'nowhere'))).toBe(false);
    expect(talk(s).start).toBe('a');
  });
});

describe('nodes', () => {
  it('adds one and takes it away again', () => {
    const s = session();
    const before = snapshot(s);
    s.run(addNode('talk', { id: 'c', lines: [{ text: 'A third.' }] }));
    expect(talk(s).nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    s.undo();
    expect(snapshot(s)).toBe(before);
  });

  it('restores a deleted node at the index it came from', () => {
    const s = session();
    s.run(addNode('talk', { id: 'c', lines: [] }));
    expect(s.run(removeNode('talk', 'b'))).toBe(true);
    expect(talk(s).nodes.map((n) => n.id)).toEqual(['a', 'c']);
    s.undo();
    // Back at index 1, so the graph does not reshuffle on undo.
    expect(talk(s).nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('refuses to delete the node the conversation opens on', () => {
    const s = session();
    expect(s.run(removeNode('talk', 'a'))).toBe(false);
    expect(talk(s).nodes.length).toBe(2);
  });

  it('leaves a reply pointing at a deleted node dangling rather than rewiring it', () => {
    const s = session();
    s.run(removeNode('talk', 'b'));
    // The validator is what tells the author; guessing a new target would be worse.
    expect(talk(s).nodes[0]!.choices?.[0]?.goto).toBe('b');
  });

  it('coalesces a drag into one undo step', () => {
    const s = session();
    for (let i = 1; i <= 10; i++) s.run(moveNode('talk', 'a', { x: i * 10, y: i }));
    expect(talk(s).nodes[0]!.position).toEqual({ x: 100, y: 10 });

    s.undo();
    // Ten pointer events, one undo — and the node had no position to begin with.
    expect(talk(s).nodes[0]!.position).toBeUndefined();
  });

  it('starts a new undo step for a second drag', () => {
    const s = session();
    s.run(moveNode('talk', 'a', { x: 10, y: 0 }));
    s.endGroup();
    s.run(moveNode('talk', 'a', { x: 90, y: 0 }));

    s.undo();
    expect(talk(s).nodes[0]!.position).toEqual({ x: 10, y: 0 });
  });

  it('coalesces typing a line, and keeps a different field separate', () => {
    const s = session();
    for (const text of ['H', 'He', 'Hello there.']) {
      s.run(updateNode('talk', 'a', { lines: [{ text }] }));
    }
    s.run(moveNode('talk', 'a', { x: 5, y: 5 }));

    s.undo();
    // The move undid; the typing survived as its own step.
    expect(talk(s).nodes[0]!.position).toBeUndefined();
    expect(talk(s).nodes[0]!.lines[0]!.text).toBe('Hello there.');

    s.undo();
    expect(talk(s).nodes[0]!.lines[0]!.text).toBe('Hello.');
  });
});

describe('replies', () => {
  it('adds one and removes it', () => {
    const s = session();
    const before = snapshot(s);
    s.run(addChoice('talk', 'a', { text: 'Actually, no.' }));
    expect(talk(s).nodes[0]!.choices?.length).toBe(2);
    s.undo();
    expect(snapshot(s)).toBe(before);
  });

  it('puts a removed reply back at its own index', () => {
    const s = session();
    s.run(addChoice('talk', 'a', { text: 'Second.' }));
    s.run(addChoice('talk', 'a', { text: 'Third.' }));

    expect(s.run(removeChoice('talk', 'a', 1))).toBe(true);
    expect(talk(s).nodes[0]!.choices?.map((c) => c.text)).toEqual(['Hello.', 'Third.']);

    s.undo();
    expect(talk(s).nodes[0]!.choices?.map((c) => c.text)).toEqual(['Hello.', 'Second.', 'Third.']);
  });

  it('does nothing when the index is not there', () => {
    const s = session();
    expect(s.run(removeChoice('talk', 'a', 9))).toBe(false);
  });

  it('rewires a reply to another node', () => {
    const s = session();
    s.run(addNode('talk', { id: 'c', lines: [] }));
    s.run(updateChoice('talk', 'a', 0, { goto: 'c' }));
    expect(talk(s).nodes[0]!.choices?.[0]?.goto).toBe('c');
    s.undo();
    expect(talk(s).nodes[0]!.choices?.[0]?.goto).toBe('b');
  });

  it('coalesces typing a reply, one undo for the sentence', () => {
    const s = session();
    for (const text of ['W', 'Wh', 'Who are you?']) {
      s.run(updateChoice('talk', 'a', 0, { text }));
    }
    expect(talk(s).nodes[0]!.choices?.[0]?.text).toBe('Who are you?');
    s.undo();
    expect(talk(s).nodes[0]!.choices?.[0]?.text).toBe('Hello.');
  });

  it('gives a reply a roll, and takes it away again', () => {
    const s = session();
    s.run(
      updateChoice('talk', 'a', 0, {
        check: { trait: 'presence', difficulty: 13, gotoOnSuccess: 'b' },
      }),
    );
    expect(talk(s).nodes[0]!.choices?.[0]?.check?.difficulty).toBe(13);
    s.undo();
    expect(talk(s).nodes[0]!.choices?.[0]?.check).toBeUndefined();
  });

  it('keeps the document parseable after all of it', () => {
    const s = session();
    s.run(addNode('talk', { id: 'c', lines: [{ text: 'New.' }], position: { x: 1, y: 2 } }));
    s.run(addChoice('talk', 'a', { text: 'Onward.', goto: 'c' }));
    s.run(moveNode('talk', 'c', { x: 40, y: 80 }));
    expect(() => projectSchema.parse(JSON.parse(JSON.stringify(s.project)))).not.toThrow();
  });
});
