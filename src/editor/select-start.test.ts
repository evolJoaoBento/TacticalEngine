/**
 * Taking hold of a party start with the Inspector's Select: it is whose sheet the side pane shows,
 * and it lets go when the start is gone or the room changes.
 */

import { describe, it, expect } from 'vitest';
import { blankScene } from '../engine/scene/grid-from-scene';
import { projectSchema, sceneSchema } from '../engine/scene/schema';
import { EditorController } from './controller';
import { EditorSession } from './session';

function room(): { editor: EditorController; session: EditorSession } {
  const scene = sceneSchema.parse({ ...blankScene('room', 8, 6), spawns: [{ x: 1, y: 1 }, { x: 5, y: 2 }] });
  const project = projectSchema.parse({
    id: 'demo',
    name: 'Demo',
    scenes: [scene, sceneSchema.parse(blankScene('hall', 4, 4))],
    startScene: 'room',
  });
  const session = new EditorSession(project);
  const editor = new EditorController({ session, sceneId: 'room', onChange: () => {} });
  editor.setMode('inspect');
  editor.setTool('select');
  return { editor, session };
}

const press = (editor: EditorController, x: number, y: number): void => {
  editor.begin({ x, y });
  editor.end();
};

describe('a party start in hand', () => {
  it('is the one pressed on, and nothing once the press lands on bare ground', () => {
    const { editor } = room();
    expect(editor.selectedStart).toBeNull();
    press(editor, 5, 2);
    expect(editor.selectedStart).toBe(1);
    press(editor, 1, 1);
    expect(editor.selectedStart).toBe(0);
    press(editor, 3, 4);
    expect(editor.selectedStart).toBeNull();
  });

  it('is still held after it is dragged somewhere else', () => {
    const { editor } = room();
    editor.begin({ x: 5, y: 2 });
    editor.paint({ x: 6, y: 4 });
    editor.end();
    expect(editor.scene.spawns[1]).toMatchObject({ x: 6, y: 4 });
    expect(editor.selectedStart).toBe(1);
  });

  it('lets go when the start is taken away, and when the room changes', () => {
    const { editor } = room();
    press(editor, 5, 2);
    // The Party start tool takes it away.
    editor.setTool('spawn');
    press(editor, 5, 2);
    expect(editor.scene.spawns).toHaveLength(1);
    expect(editor.selectedStart).toBeNull();

    // That tool is Combat's; back in the Inspector for the next press.
    editor.setMode('inspect');
    press(editor, 1, 1);
    expect(editor.selectedStart).toBe(0);
    editor.switchScene('hall');
    expect(editor.selectedStart).toBeNull();
  });
});
