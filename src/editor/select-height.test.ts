/**
 * The Z ladder with Select in hand: it raises and lowers whatever Select took hold of - a prop, a
 * piece of building - as one undoable edit, and is the build plane when Select holds nothing.
 */

import { describe, it, expect } from 'vitest';
import { blankScene } from '../engine/scene/grid-from-scene';
import { projectSchema, sceneSchema } from '../engine/scene/schema';
import { EditorController } from './controller';
import { EditorSession } from './session';

/** A room with a kind of tile that stacks, a prop at 1,1 and a piece at 4,2; Terrain's Select in hand. */
function room(): { editor: EditorController; session: EditorSession; changes: string[] } {
  const project = projectSchema.parse({
    id: 'demo',
    name: 'Demo',
    scenes: [sceneSchema.parse(blankScene('room', 8, 6))],
    startScene: 'room',
    terrainPalette: [
      { id: 'floor', name: 'Floor', passable: true, cost: 1, providesCover: false, blocksSight: false },
      { id: 'rampart', name: 'Rampart', passable: false, cost: 1, providesCover: true, blocksSight: true, structure: 'block' },
    ],
  });
  const session = new EditorSession(project);
  const changes: string[] = [];
  const editor = new EditorController({ session, sceneId: 'room', onChange: (c) => changes.push(c) });
  editor.setMode('terrain');
  editor.setTool('prop');
  editor.begin({ x: 1, y: 1 });
  editor.end();
  editor.setTool('placeTile');
  editor.set('tileId', 'rampart');
  editor.begin({ x: 4, y: 2 });
  editor.end();
  editor.setTool('select');
  changes.length = 0;
  return { editor, session, changes };
}

const press = (editor: EditorController, x: number, y: number): void => {
  editor.begin({ x, y });
  editor.end();
};

describe('the Z ladder with Select in hand', () => {
  it('raises a prop Select took hold of, as one undo step, and the plane goes with it', () => {
    const { editor, session } = room();
    press(editor, 1, 1);
    expect(editor.selectionLevel).toBe(0);

    expect(editor.setSelectionLevel(1.5)).toBe(true);
    expect(session.requireScene('room').decos[0]!.position).toEqual({ x: 1, y: 1, z: 1.5 });
    expect(editor.selectionLevel).toBe(1.5);
    expect(editor.state.buildLevel).toBe(1.5);

    session.undo();
    expect(session.requireScene('room').decos[0]!.position).toEqual({ x: 1, y: 1 });
  });

  it('puts a prop back on the ground saying nothing about Z, as one placed there never did', () => {
    const { editor, session } = room();
    press(editor, 1, 1);
    editor.setSelectionLevel(2);
    editor.setSelectionLevel(0);
    expect(session.requireScene('room').decos[0]!.position).toEqual({ x: 1, y: 1 });
  });

  it('raises a piece of building, and keeps hold of it though its key moves with its level', () => {
    const { editor, session, changes } = room();
    press(editor, 4, 2);
    expect(editor.selectionLevel).toBe(0);
    expect(editor.setSelectionLevel(1)).toBe(true);
    const tiles = session.requireScene('room').buildingTiles!;
    expect(Object.values(tiles).map((piece) => [piece.x, piece.y, piece.level])).toEqual([[4, 2, 1]]);
    // A piece is ground: the grid is rebuilt for it.
    expect(changes).toContain('terrain');
    // Still the one in hand after its key changed, so the ladder moves it again.
    expect(editor.selectionLevel).toBe(1);
    editor.setSelectionLevel(0.25);
    expect(Object.values(session.requireScene('room').buildingTiles!).map((piece) => piece.level)).toEqual([0.25]);
  });

  it('is the build plane when Select holds nothing, and moves nothing', () => {
    const { editor, session } = room();
    press(editor, 6, 5);
    expect(editor.selectionLevel).toBeNull();
    const before = JSON.stringify(session.requireScene('room'));
    expect(editor.setSelectionLevel(2)).toBe(false);
    expect(editor.state.buildLevel).toBe(2);
    expect(JSON.stringify(session.requireScene('room'))).toBe(before);
  });

  it('lets go of the piece when something else is taken hold of', () => {
    const { editor } = room();
    press(editor, 4, 2);
    press(editor, 1, 1);
    editor.setSelectionLevel(1);
    // The prop moved, not the piece.
    expect(editor.selectionLevel).toBe(1);
    expect(editor.selectedDeco?.position.z).toBe(1);
  });
});
