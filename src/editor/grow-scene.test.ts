import { describe, expect, it } from 'vitest';
import { blankScene, gridFromScene, paletteForProject } from '../engine/scene/grid-from-scene';
import { projectSchema } from '../engine/scene/schema';
import { EditorController, type EditorChange } from './controller';
import { EditorSession } from './session';
import { validateProject } from './validate';

/** A 4 by 4 room with a door, a spawn and a platform in hand: tiles laid outside it should become room. */
function setup(growable?: () => boolean) {
  const scene = blankScene('room', 4, 4);
  scene.spawns = [{ x: 1, y: 1 }];
  const project = projectSchema.parse({
    id: 'test',
    startScene: 'room',
    scenes: [{ ...scene, interactables: [{ id: 'door', kind: 'door', position: { x: 3, y: 2 } }] }],
    terrainPalette: [
      { id: 'floor', name: 'Floor', passable: true, cost: 1, providesCover: false, blocksSight: false },
      { id: 'pier', name: 'Pier', passable: true, cost: 1, providesCover: false, blocksSight: false, structure: 'floor' },
    ],
  });
  const session = new EditorSession(project);
  const changes: EditorChange[] = [];
  const editor = new EditorController({ session, sceneId: 'room', onChange: (change) => changes.push(change), ...(growable === undefined ? {} : { growable }) });
  editor.setTool('placeTile');
  editor.set('tileId', 'pier');
  return { project, session, editor, changes };
}

const stamp = (editor: EditorController, x: number, y: number): void => {
  editor.begin({ x, y });
  editor.end();
};

describe('a room growing to reach tiles laid outside it', () => {
  it('grows east, and what was laid there is floor', () => {
    const { editor, session, changes } = setup();
    stamp(editor, 6, 1);
    const scene = session.requireScene('room');
    expect([scene.width, scene.height]).toEqual([7, 4]);
    expect(scene.origin).toBeUndefined();
    expect(Object.keys(scene.buildingTiles!)).toEqual(['6,1,0']);
    // Once for the tile and once for the room: the second is what rebuilds the grid at its new size.
    expect(changes).toEqual(['terrain', 'terrain']);
    const { grid, issues } = gridFromScene(scene, paletteForProject(session.project));
    expect(issues).toEqual([]);
    expect(grid.isPassable(grid.indexOf(6, 1))).toBe(true);
    expect(grid.isPassable(grid.indexOf(5, 1))).toBe(false);
    expect(grid.isPassable(grid.indexOf(3, 1))).toBe(true);
  });

  it('grows west, moving the room and everything in it, when the stroke ends and not before', () => {
    const { editor, session } = setup();
    editor.begin({ x: -1, y: 1 });
    expect(session.requireScene('room').width).toBe(4);
    editor.end();
    const scene = session.requireScene('room');
    expect([scene.width, scene.height]).toEqual([5, 4]);
    expect(scene.origin).toEqual({ x: 1, y: 0 });
    expect(Object.keys(scene.buildingTiles!)).toEqual(['0,1,0']);
    expect(scene.spawns).toEqual([{ x: 2, y: 1 }]);
    expect(scene.interactables[0]!.position).toMatchObject({ x: 4, y: 2 });
    expect(() => projectSchema.parse(JSON.parse(JSON.stringify(session.project)))).not.toThrow();
  });

  it('is one undo with the tiles that caused it, back to the document as it was - and one redo', () => {
    const { editor, session, project } = setup();
    const before = JSON.stringify(project);
    stamp(editor, 1, 1);
    const first = JSON.stringify(project);
    // Inside, out past the west edge and the north, and back inside: one stroke of a wide brush.
    editor.set('brushSize', 3);
    stamp(editor, -2, -1);
    const grown = JSON.stringify(project);
    expect(session.requireScene('room').width).toBe(7);
    expect(session.requireScene('room').height).toBe(6);
    expect(session.undo()).toBe(true);
    expect(JSON.stringify(project)).toBe(first);
    expect(session.redo()).toBe(true);
    expect(JSON.stringify(project)).toBe(grown);
    session.undo();
    session.undo();
    expect(JSON.stringify(project)).toBe(before);
    expect(session.canUndo).toBe(false);
  });

  it('leaves a piece a long way off as scenery, and an erase as an erase', () => {
    const { editor, session } = setup();
    stamp(editor, -900_000, 900_000);
    expect(session.requireScene('room').width).toBe(4);
    editor.setTool('eraseTile');
    stamp(editor, 9, 9);
    expect(session.requireScene('room').width).toBe(4);
  });

  it('waits when it is told the room cannot change shape just now', () => {
    const { editor, session } = setup(() => false);
    stamp(editor, 6, 1);
    expect(session.requireScene('room').width).toBe(4);
    expect(Object.keys(session.requireScene('room').buildingTiles!)).toEqual(['6,1,0']);
  });

  it('passes Check: nothing is a kind every project knows', () => {
    const { editor, session } = setup();
    stamp(editor, -2, 5);
    expect(validateProject(session.project).filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(validateProject(session.project).some((issue) => issue.message.includes('void'))).toBe(false);
  });
});
