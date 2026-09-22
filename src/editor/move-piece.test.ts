import { describe, expect, it } from 'vitest';
import { blankScene } from '../engine/scene/grid-from-scene';
import { projectSchema } from '../engine/scene/schema';
import { EditorController } from './controller';
import { EditorSession } from './session';

/** A 6 by 4 room with a platform and a block laid in it, and the Terrain tab's Select in hand. */
function setup() {
  const project = projectSchema.parse({
    id: 'test',
    startScene: 'room',
    scenes: [blankScene('room', 6, 4)],
    terrainPalette: [
      { id: 'floor', name: 'Floor', passable: true, cost: 1, providesCover: false, blocksSight: false },
      { id: 'pier', name: 'Pier', passable: true, cost: 1, providesCover: false, blocksSight: false, structure: 'floor' },
      { id: 'plinth', name: 'Plinth', passable: true, cost: 1, providesCover: false, blocksSight: false, structure: 'block' },
    ],
  });
  const session = new EditorSession(project);
  const changes: string[] = [];
  const editor = new EditorController({ session, sceneId: 'room', onChange: (change) => changes.push(change) });
  editor.setMode('terrain');
  editor.setTool('placeTile');
  editor.set('tileId', 'pier');
  editor.begin({ x: 1, y: 1 });
  editor.end();
  editor.set('tileId', 'plinth');
  editor.set('buildLevel', 0.25);
  editor.set('buildRotation', 1);
  editor.begin({ x: 1, y: 1 });
  editor.end();
  editor.set('buildLevel', 2);
  editor.setTool('select');
  changes.length = 0;
  return { project, session, editor, changes, scene: session.requireScene('room') };
}

const keys = (scene: { buildingTiles?: Record<string, unknown> }): string[] => Object.keys(scene.buildingTiles ?? {}).sort();

describe('picking up a piece with Select in the Terrain tab', () => {
  it('takes the topmost piece on the cell, carries it, and puts it down under the key of its new cell', () => {
    const { editor, scene, changes } = setup();
    expect(keys(scene)).toEqual(['1,1,0', '1,1,0.25']);
    editor.begin({ x: 1, y: 1 });
    expect(editor.carried).toMatchObject({ kind: 'piece', key: '1,1,0.25', rotation: Math.PI / 2 });
    expect(editor.carried!.piece).toMatchObject({ shape: 'block', tile: 'plinth' });
    // The ladder went to the piece's level, so the plane under the pointer is the piece's own.
    expect(editor.state.buildLevel).toBe(0.25);
    editor.paint({ x: 4, y: 2 });
    editor.end();
    expect(keys(scene)).toEqual(['1,1,0', '4,2,0.25']);
    expect(scene.buildingTiles!['4,2,0.25']).toMatchObject({ x: 4, y: 2, level: 0.25, rotation: 1, shape: 'block', tile: 'plinth' });
    expect(changes).toEqual(['terrain']); // the ground is rebuilt for it, since a piece is ground
  });

  it('is one undo, back to the document as it was, and a redo', () => {
    const { editor, session, project } = setup();
    const before = JSON.stringify(project);
    editor.begin({ x: 1, y: 1 });
    editor.paint({ x: 3, y: 3 });
    editor.end();
    const moved = JSON.stringify(project);
    expect(moved).not.toBe(before);
    expect(session.undo()).toBe(true);
    expect(JSON.stringify(project)).toBe(before);
    expect(session.redo()).toBe(true);
    expect(JSON.stringify(project)).toBe(moved);
  });

  it('put down where it was picked up is no edit at all', () => {
    const { editor, session, project } = setup();
    const before = JSON.stringify(project);
    const undos = session.canUndo;
    editor.begin({ x: 1, y: 1 });
    editor.paint({ x: 2, y: 1 });
    editor.paint({ x: 1, y: 1 });
    editor.end();
    expect(JSON.stringify(project)).toBe(before);
    expect(session.canUndo).toBe(undos);
  });

  it('stacks on a cell that already holds a piece, turns with the hand, and lands at the level the ladder was wheeled to', () => {
    const { editor, scene } = setup();
    editor.begin({ x: 1, y: 1 });
    editor.paint({ x: 1, y: 1 });
    // Wheeled up two blocks while held, and turned a quarter more.
    editor.state.buildLevel = 2.25;
    expect(editor.turnCarried(2)).toBe(true);
    editor.end();
    expect(keys(scene)).toEqual(['1,1,0', '1,1,2.25']);
    expect(scene.buildingTiles!['1,1,2.25']).toMatchObject({ level: 2.25, rotation: 2 });
    // And onto the pier's own cell and level: a second key, since both stand there.
    editor.state.buildLevel = 0;
    editor.begin({ x: 1, y: 1 });
    editor.state.buildLevel = 0;
    editor.paint({ x: 1, y: 1 });
    editor.end();
    expect(keys(scene)).toEqual(['1,1,0', '1,1,0#1']);
  });

  it('reaches a piece laid outside the room, and grows the room round where one is put down', () => {
    const { editor, scene, session } = setup();
    editor.begin({ x: 1, y: 1 });
    editor.paint({ x: 8, y: 1 });
    editor.end();
    expect(scene.width).toBe(9);
    expect(scene.buildingTiles!['8,1,0.25']).toBeDefined();
    // One undo takes back the growth and the move together.
    session.undo();
    expect(scene.width).toBe(6);
    expect(keys(scene)).toEqual(['1,1,0', '1,1,0.25']);
    // Scenery - a piece that is no kind of tile - is carried the same and grows nothing.
    delete scene.buildingTiles!['1,1,0.25']!.tile;
    editor.begin({ x: 1, y: 1 });
    editor.paint({ x: -3, y: 1 });
    editor.end();
    expect(scene.width).toBe(6);
    expect(scene.buildingTiles!['-3,1,0.25']).toBeDefined();
    editor.begin({ x: -3, y: 1 });
    expect(editor.carried).toMatchObject({ kind: 'piece', key: '-3,1,0.25' });
    editor.end();
  });

  it('is not what Select does in the Inspector, where a piece is not a thing to hold', () => {
    const { editor } = setup();
    editor.setMode('inspect');
    editor.begin({ x: 1, y: 1 });
    expect(editor.carried).toBeNull();
    editor.end();
  });
});
