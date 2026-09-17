import { describe, expect, it } from 'vitest';
import { blankScene, gridFromScene } from '../engine/scene/grid-from-scene';
import { projectSchema } from '../engine/scene/schema';
import { buildingParts, buildingTilesSchema } from '../engine/scene/building';
import { EditorController } from './controller';
import { EditorSession } from './session';

/**
 * One small room with a stackable kind of tile in hand, which is where every case starts.
 *
 * There is no build tool any more: the placer stamps a piece when the kind of tile it
 * holds names a structure, and paints ground when it does not. So the palette has to
 * declare kinds that are structures - the engine's four are all ground, `wall` included,
 * so that every cell painted with it before the fusion stays what it was.
 */
function setup() {
  const project = projectSchema.parse({
    id: 'test',
    startScene: 'room',
    scenes: [blankScene('room', 4, 4)],
    terrainPalette: [
      { id: 'floor', name: 'Floor', passable: true, cost: 1, providesCover: false, blocksSight: false },
      { id: 'pier', name: 'Pier', passable: true, cost: 1, providesCover: false, blocksSight: false, structure: 'floor' },
      { id: 'rampart', name: 'Rampart', passable: false, cost: 1, providesCover: true, blocksSight: true, structure: 'wall' },
      { id: 'flight', name: 'Flight', passable: true, cost: 1, providesCover: false, blocksSight: false, structure: 'stairs' },
      { id: 'plinth', name: 'Plinth', passable: false, cost: 1, providesCover: false, blocksSight: false, structure: 'block' },
    ],
  });
  const session = new EditorSession(project);
  const editor = new EditorController({ session, sceneId: 'room' });
  editor.setTool('placeTile');
  editor.set('tileId', 'plinth');
  return { project, session, editor, scene: editor.scene };
}

/** One press and release: a click, which is one undo step. */
function stamp(editor: EditorController, x: number, y: number): void {
  editor.begin({ x, y });
  editor.end();
}

describe('sparse construction', () => {
  it('keeps four edge walls, a floor and repeated identical pieces at the same position', () => {
    const { editor, scene, session, project } = setup();
    editor.set('tileId', 'pier');
    stamp(editor, 0, 0);
    editor.set('tileId', 'rampart');
    for (let rotation = 0; rotation < 4; rotation++) {
      editor.set('buildRotation', rotation);
      stamp(editor, 0, 0);
    }
    stamp(editor, 0, 0);
    expect(Object.values(scene.buildingTiles!)).toHaveLength(6);
    expect(projectSchema.parse(JSON.parse(JSON.stringify(project)))).toEqual(project);
    editor.setTool('eraseTile');
    stamp(editor, 0, 0);
    expect(Object.values(scene.buildingTiles!)).toHaveLength(5);
    session.undo();
    expect(Object.values(scene.buildingTiles!)).toHaveLength(6);
    // A wall's far face sits on the tile's edge, so four of them meet at the corners.
    const wall = buildingParts('wall')[0]!;
    expect(wall[2] - wall[5] / 2).toBeCloseTo(-0.5);
    expect(wall[3]).toBe(1);
  });
  it('authors fractional Z and piece height, and leaves the ground in whole levels', () => {
    const { editor, scene, session } = setup();
    editor.set('buildLevel', 2.25);
    editor.set('buildHeight', 3.5);
    stamp(editor, 0, 0);
    expect(scene.buildingTiles!['0,0,2.25']).toMatchObject({ level: 2.25, height: 3.5 });
    // Two vertical units coexist until part 2 unifies them: the plane the piece
    // stands on counts tiles, while `heights[]` counts whole levels, so painting
    // the ground from the same tab must not write 2.25 into it.
    editor.openTerrainTab('tiles');
    editor.set('tileId', 'floor');
    editor.begin({ x: 1, y: 1 });
    editor.paint({ x: 2, y: 1 });
    editor.end();
    expect(scene.heights[5]).toBe(0);
    expect(scene.terrain[5]).toBe('floor');
    expect(gridFromScene(scene).grid.heightAt(5)).toBe(0);
    // Painted ground, not a stamped piece: `floor` names no structure.
    expect(scene.buildingTiles!['1,1,2.25']).toBeUndefined();
  });
  it('takes placement behavior from the open tab, retaining each tab selection', () => {
    const { editor, scene } = setup();
    editor.openTerrainTab('props');
    stamp(editor, -20, 80);
    expect(scene.decos).toHaveLength(1);
    editor.openTerrainTab('objects');
    stamp(editor, -20, 80);
    expect(scene.interactables).toHaveLength(1);
    editor.openTerrainTab('tiles');
    stamp(editor, -20, 80);
    expect(Object.values(scene.buildingTiles!)).toHaveLength(1);
  });
  it('stamps where it is clicked rather than following a drag', () => {
    const { editor, scene, session } = setup();
    editor.begin({ x: -20, y: 0 });
    editor.paint({ x: -10, y: 0 });
    editor.end();
    // One piece, not eleven. Building used to be a drag that filled in every sample it
    // skipped; it is a placer now, because that is what it was fused with and what the
    // user asked for by name. Erase is still a drag - it is on the rail, not the strip.
    expect(Object.keys(scene.buildingTiles!)).toEqual(['-20,0,0']);
    session.undo();
    expect(scene.buildingTiles).toBeUndefined();
  });
  it('builds far apart and below ground without enlarging the tactical arrays', () => {
    const { editor, scene, project } = setup();
    stamp(editor, -1_000_000, 1_000_000);
    editor.set('buildLevel', -30);
    stamp(editor, 900_000, -800_000);
    expect(Object.keys(scene.buildingTiles!)).toHaveLength(2);
    expect(scene.terrain).toHaveLength(16);
    expect(projectSchema.parse(JSON.parse(JSON.stringify(project)))).toEqual(project);
  });
  it('coalesces a brush drag, retains overlapping pieces, and redoes it', () => {
    const { editor, scene, session } = setup();
    stamp(editor, -4, 0);
    editor.set('tileId', 'flight');
    editor.set('buildRotation', 3);
    editor.set('brushSize', 3);
    stamp(editor, -3, 0);
    // A brush still covers a square in one click, which is the one undo step.
    expect(Object.keys(scene.buildingTiles!)).toHaveLength(10);
    session.undo();
    expect(Object.keys(scene.buildingTiles!)).toEqual(['-4,0,0']);
    // The shape came off the kind of tile, not a chip beside it.
    expect(scene.buildingTiles!['-4,0,0']!.shape).toBe('block');
    expect(scene.buildingTiles!['-4,0,0']!.tile).toBe('plinth');
    session.redo();
    expect(scene.buildingTiles!['-4,0,0#1']!.rotation).toBe(3);
    expect(scene.buildingTiles!['-4,0,0#1']!.shape).toBe('stairs');
  });
  it('erases only the chosen level and undoes a complete first stroke to the original document', () => {
    const { editor, scene, session, project } = setup();
    const before = JSON.stringify(project);
    stamp(editor, 1000, 0);
    session.undo();
    expect(JSON.stringify(project)).toBe(before);
    session.redo();
    editor.set('buildLevel', 1);
    stamp(editor, 1000, 0);
    editor.setTool('eraseTile');
    stamp(editor, 1000, 0);
    expect(scene.buildingTiles!['1000,0,0']).toBeDefined();
    expect(scene.buildingTiles!['1000,0,1']).toBeUndefined();
    session.undo();
    expect(scene.buildingTiles!['1000,0,1']).toBeDefined();
  });
  it('ignores repeated samples within a stroke and clips brushes at precision bounds', () => {
    const { editor, session, scene } = setup();
    expect(editor.begin({ x: Infinity, y: 0 })).toBe('none');
    expect(editor.begin({ x: 0.5, y: 0 })).toBe('none');
    expect(session.canUndo).toBe(false);
    editor.set('brushSize', 3);
    editor.begin({ x: 1_000_000, y: 1_000_000 });
    expect(Object.keys(scene.buildingTiles!)).toHaveLength(4);
    editor.end();
    session.undo();
    expect(scene.buildingTiles).toBeUndefined();
  });
  it('validates coordinate keys, rotations, finite coordinates and supported pieces', () => {
    const tile = { x: 0, y: 0, level: 0, shape: 'wall', material: 'wood', rotation: 0 };
    expect(buildingTilesSchema.safeParse({ '0,0,0': tile }).success).toBe(true);
    const broken = [
      { ...tile, rotation: 4 },
      { ...tile, x: 1_000_001 },
      { ...tile, shape: 'unknown' },
      { ...tile, level: NaN },
    ];
    for (const value of broken) {
      expect(buildingTilesSchema.safeParse({ '0,0,0': value }).success).toBe(false);
    }
    expect(buildingTilesSchema.safeParse({ '1,0,0': tile }).success).toBe(false);
    expect(buildingParts('stairs')).toHaveLength(4);
    expect(buildingParts('stairs', true)).toHaveLength(1);
    expect(buildingParts('floor')[0]![4]).toBe(0.25);
  });
});
