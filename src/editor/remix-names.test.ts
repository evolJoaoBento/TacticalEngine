/**
 * What a remix is called: the name typed when it is saved, or - with none typed - what it is, how
 * big and what it does; and renamed afterwards, each rename one undo step.
 */

import { describe, it, expect } from 'vitest';
import { blankScene } from '../engine/scene/grid-from-scene';
import { projectSchema, sceneSchema } from '../engine/scene/schema';
import { EditorController } from './controller';
import { EditorSession } from './session';

function setup(): { editor: EditorController; session: EditorSession } {
  const session = new EditorSession(
    projectSchema.parse({
      id: 'p',
      name: 'P',
      scenes: [sceneSchema.parse({ ...blankScene('room', 8, 6), spawns: [{ x: 1, y: 1 }] })],
      startScene: 'room',
    }),
  );
  const editor = new EditorController({ session, sceneId: 'room', onChange: () => {} });
  editor.setTool('prop');
  editor.set('propModel', 'pillar');
  editor.set('propSpan', 2);
  return { editor, session };
}

describe("a remix's name", () => {
  it('is what was typed when it was saved, and what it is when nothing was', () => {
    const { editor } = setup();
    expect(editor.remixLabel()).toBe('Pillar 2×2');
    const named = editor.saveRemix('  Old column ')!;
    expect(editor.propPresets.find((p) => p.id === named)!.label).toBe('Old column');
    editor.set('propSolid', true);
    const plain = editor.saveRemix('   ')!;
    expect(editor.propPresets.find((p) => p.id === plain)!.label).toBe('Pillar 2×2 · solid');
  });

  it('renames the remix already holding the same settings, rather than saving the card twice', () => {
    const { editor } = setup();
    const id = editor.saveRemix()!;
    expect(editor.saveRemix('Twin pillars')).toBe(id);
    expect(editor.propPresets).toHaveLength(1);
    expect(editor.propPresets[0]!.label).toBe('Twin pillars');
  });

  it('can be changed afterwards, back to what it is when emptied, and each change undoes on its own', () => {
    const { editor, session } = setup();
    const id = editor.saveRemix('First')!;
    expect(editor.renameRemix(id, 'Second')).toBe(true);
    expect(editor.propPresets[0]!.label).toBe('Second');
    editor.renameRemix(id, '');
    expect(editor.propPresets[0]!.label).toBe('Pillar 2×2');
    session.undo();
    expect(editor.propPresets[0]!.label).toBe('Second');
    session.undo();
    expect(editor.propPresets[0]!.label).toBe('First');
    // The same name again changes nothing, and is not an undo step.
    expect(editor.renameRemix(id, 'First')).toBe(false);
    expect(editor.renameRemix('no-such-remix', 'X')).toBe(false);
  });
});
