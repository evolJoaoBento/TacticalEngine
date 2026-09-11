import { describe, expect, it } from 'vitest';
import { blankScene, gridFromScene } from '../engine/scene/grid-from-scene';
import { projectSchema } from '../engine/scene/schema';
import { buildingParts, buildingTilesSchema } from '../engine/scene/building';
import { EditorController } from './controller';
import { EditorSession } from './session';

function setup() {
  const project = projectSchema.parse({ id: 'test', startScene: 'room', scenes: [blankScene('room', 4, 4)] });
  const session = new EditorSession(project);
  const editor = new EditorController({ session, sceneId: 'room' });
  editor.setTool('buildTile');
  return { project, session, editor, scene: editor.scene };
}

describe('sparse construction', () => {
  it('keeps four edge walls, a floor and repeated identical pieces at the same position', () => {
    const { editor, scene, session, project } = setup();
    editor.set('buildShape', 'floor'); editor.begin({ x: 0, y: 0 }); editor.end();
    editor.set('buildShape', 'wall');
    for (let rotation = 0; rotation < 4; rotation++) {
      editor.set('buildRotation', rotation); editor.begin({ x: 0, y: 0 }); editor.end();
    }
    editor.begin({ x: 0, y: 0 }); editor.end();
    expect(Object.values(scene.buildingTiles!)).toHaveLength(6);
    expect(projectSchema.parse(JSON.parse(JSON.stringify(project)))).toEqual(project);
    editor.setTool('eraseTile'); editor.begin({ x: 0, y: 0 }); editor.end();
    expect(Object.values(scene.buildingTiles!)).toHaveLength(5);
    session.undo(); expect(Object.values(scene.buildingTiles!)).toHaveLength(6);
    const wall = buildingParts('wall')[0]!;
    expect(wall[2]! - wall[5]! / 2).toBeCloseTo(-0.5);
    expect(wall[3]).toBe(1);
  });
  it('authors fractional Z and piece height, and paints the ground at the same physical Z', () => {
    const { editor, scene, session } = setup();
    editor.set('buildLevel', 2.25); editor.set('buildHeight', 3.5);
    editor.begin({ x: 0, y: 0 }); editor.end();
    expect(scene.buildingTiles!['0,0,2.25']).toMatchObject({ level: 2.25, height: 3.5 });
    editor.openTerrainTab('ground'); editor.set('paintHeight', true); editor.set('terrainId', 'wall');
    editor.begin({ x: 1, y: 1 }); editor.paint({ x: 2, y: 1 }); editor.end();
    const grid = gridFromScene(scene).grid;
    expect(grid.heightAt(5) * 0.35).toBeCloseTo(2.25);
    expect(grid.heightAt(6) * 0.35).toBeCloseTo(2.25);
    session.undo(); expect(scene.heights[5]).toBe(0); expect(scene.terrain[5]).toBe('floor');
    session.redo(); expect(scene.heights[5]! * 0.35).toBeCloseTo(2.25);
  });
  it('takes placement behavior from the open tab, retaining each tab selection', () => {
    const { editor, scene } = setup();
    editor.openTerrainTab('props'); editor.begin({ x: -20, y: 80 }); editor.end();
    expect(scene.decos).toHaveLength(1);
    editor.openTerrainTab('objects'); editor.begin({ x: -20, y: 80 }); editor.end();
    expect(scene.interactables).toHaveLength(1);
    editor.openTerrainTab('tiles'); editor.begin({ x: -20, y: 80 }); editor.end();
    expect(Object.values(scene.buildingTiles!)).toHaveLength(1);
  });
  it('fills skipped pointer samples in a stroke and undoes it once', () => {
    const { editor, scene, session } = setup();
    editor.begin({ x: -20, y: 0 }); editor.paint({ x: -10, y: 0 }); editor.end();
    expect(Object.keys(scene.buildingTiles!)).toHaveLength(11);
    session.undo();
    expect(scene.buildingTiles).toBeUndefined();
  });
  it('builds far apart and below ground without enlarging the tactical arrays', () => {
    const { editor, scene, project } = setup();
    editor.begin({ x: -1_000_000, y: 1_000_000 }); editor.end();
    editor.set('buildLevel', -30);
    editor.begin({ x: 900_000, y: -800_000 }); editor.end();
    expect(Object.keys(scene.buildingTiles!)).toHaveLength(2);
    expect(scene.terrain).toHaveLength(16);
    expect(projectSchema.parse(JSON.parse(JSON.stringify(project)))).toEqual(project);
  });
  it('coalesces a brush drag, retains overlapping pieces, and redoes it', () => {
    const { editor, scene, session } = setup();
    editor.begin({ x: -4, y: 0 }); editor.end();
    editor.set('buildShape', 'stairs'); editor.set('buildRotation', 3);
    editor.begin({ x: -4, y: 0 }); editor.paint({ x: -3, y: 0 }); editor.paint({ x: -2, y: 0 }); editor.end();
    expect(Object.keys(scene.buildingTiles!)).toHaveLength(4);
    session.undo();
    expect(Object.keys(scene.buildingTiles!)).toEqual(['-4,0,0']);
    expect(scene.buildingTiles!['-4,0,0']!.shape).toBe('block');
    session.redo();
    expect(Object.keys(scene.buildingTiles!)).toHaveLength(4);
    expect(scene.buildingTiles!['-4,0,0#1']!.rotation).toBe(3);
  });
  it('erases only the chosen level and undoes a complete first stroke to the original document', () => {
    const { editor, scene, session, project } = setup();
    const before = JSON.stringify(project);
    editor.begin({ x: 1000, y: 0 }); editor.paint({ x: 1001, y: 0 }); editor.end();
    session.undo();
    expect(JSON.stringify(project)).toBe(before);
    session.redo();
    editor.set('buildLevel', 1); editor.begin({ x: 1000, y: 0 }); editor.end();
    editor.setTool('eraseTile'); editor.begin({ x: 1000, y: 0 }); editor.end();
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
    expect(editor.paint({ x: 1_000_000, y: 1_000_000 })).toBe('none'); editor.end();
    session.undo();
    expect(scene.buildingTiles).toBeUndefined();
  });
  it('validates coordinate keys, rotations, finite coordinates and supported pieces', () => {
    const tile = { x: 0, y: 0, level: 0, shape: 'wall', material: 'wood', rotation: 0 };
    expect(buildingTilesSchema.safeParse({ '0,0,0': tile }).success).toBe(true);
    for (const value of [ { ...tile, rotation: 4 }, { ...tile, x: 1_000_001 }, { ...tile, shape: 'unknown' }, { ...tile, level: NaN } ]) {
      expect(buildingTilesSchema.safeParse({ '0,0,0': value }).success).toBe(false);
    }
    expect(buildingTilesSchema.safeParse({ '1,0,0': tile }).success).toBe(false);
    expect(buildingParts('stairs')).toHaveLength(4);
    expect(buildingParts('stairs', true)).toHaveLength(1);
    expect(buildingParts('floor')[0]![4]).toBe(0.25);
  });
});
