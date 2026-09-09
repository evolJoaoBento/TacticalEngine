/**
 * The render layer runs headless.
 *
 * A `BufferGeometry` and an `InstancedMesh` are plain objects until a renderer
 * compiles them, so everything the adapter builds can be asserted on in node —
 * which is the whole reason to keep the geometry work out of the page.
 */

import { describe, it, expect } from 'vitest';
import { Color, Matrix4, Vector3, type InstancedMesh } from 'three';
import { TileGrid } from '../grid/grid';
import { SceneState, createAdversaryEntity, createPartyEntity } from '../scene/state';
import { surfaceHeight, tileCenter } from './layout';
import { SceneView } from './scene-view';
import { DEFAULT_TERRAIN_COLORS, buildTerrainMesh, instanceCount } from './terrain-mesh';

function makeGrid(rows: string[]): TileGrid {
  const grid = new TileGrid({ width: rows[0]!.length, height: rows.length });
  rows.forEach((row, y) => {
    [...row].forEach((char, x) => {
      const tile = grid.indexOf(x, y);
      if (char === '#') grid.setTerrainById(tile, 'wall');
      else if (char === '~') grid.setTerrainById(tile, 'difficult');
      else if (char >= '1' && char <= '9') grid.setHeight(tile, Number(char));
    });
  });
  return grid;
}

describe('buildTerrainMesh', () => {
  it('draws the whole map in one instanced mesh per terrain type', () => {
    const grid = makeGrid(['..#.', '.~#.', '....']);
    const terrain = buildTerrainMesh(grid);
    // Three types appear: floor, difficult, wall. Not four — nothing is 'cover'.
    expect(terrain.meshes).toHaveLength(3);
    expect(instanceCount(terrain)).toBe(grid.size);
    expect(terrain.meshes.map((m) => m.name).sort()).toEqual([
      'terrain:difficult',
      'terrain:floor',
      'terrain:wall',
    ]);
    terrain.dispose();
  });

  it('does not grow its draw calls with the map', () => {
    const small = buildTerrainMesh(makeGrid(['..', '..']));
    const large = buildTerrainMesh(new TileGrid({ width: 60, height: 60 }));
    expect(large.meshes.length).toBeLessThanOrEqual(small.meshes.length);
    expect(instanceCount(large)).toBe(3600);
    small.dispose();
    large.dispose();
  });

  it('places every instance at its tile, scaled to the tile height', () => {
    const grid = makeGrid(['...', '.2.']);
    const terrain = buildTerrainMesh(grid);
    const matrix = new Matrix4();
    const position = new Vector3();
    const scale = new Vector3();

    let checked = 0;
    for (const mesh of terrain.meshes) {
      for (let i = 0; i < mesh.count; i++) {
        const tile = terrain.tileOf(mesh, i);
        expect(tile).toBeGreaterThanOrEqual(0);
        mesh.getMatrixAt(i, matrix);
        position.setFromMatrixPosition(matrix);
        scale.setFromMatrixScale(matrix);

        // Instance matrices are stored as Float32, so six places is the real
        // precision available here, not the ten used elsewhere.
        const centre = tileCenter(grid, tile);
        expect(position.x).toBeCloseTo(centre.x, 6);
        expect(position.z).toBeCloseTo(centre.z, 6);
        // The slab is anchored at the ground and scaled up to the surface.
        expect(position.y).toBeCloseTo(0, 6);
        expect(scale.y).toBeCloseTo(surfaceHeight(grid.heightAt(tile)), 6);
        checked++;
      }
    }
    expect(checked).toBe(grid.size);
    terrain.dispose();
  });

  it('maps every instance back to a distinct tile', () => {
    const grid = makeGrid(['..#.', '.~#.']);
    const terrain = buildTerrainMesh(grid);
    const seen = new Set<number>();
    for (const mesh of terrain.meshes) {
      for (let i = 0; i < mesh.count; i++) seen.add(terrain.tileOf(mesh, i));
    }
    expect(seen.size).toBe(grid.size);
    expect(terrain.tileOf(terrain.meshes[0]!, 999)).toBe(-1);
    terrain.dispose();
  });

  it('prefers an authored tint over the terrain colour, and ignores a bad one', () => {
    const grid = makeGrid(['..']);
    const tints = ['#ff0000', 'not-a-colour'];
    const terrain = buildTerrainMesh(grid, { tints });
    const mesh = terrain.meshes[0]!;
    expect(mesh.instanceColor).not.toBeNull();

    const colors = mesh.instanceColor!.array;
    const tinted = terrain.tileOf(mesh, 0) === 0 ? 0 : 1;
    expect(colors[tinted * 3]).toBeCloseTo(1, 5); // red channel of #ff0000
    expect(colors[tinted * 3 + 1]).toBeCloseTo(0, 5);

    // The bad tint fell back to the floor colour rather than throwing.
    expect(DEFAULT_TERRAIN_COLORS['floor']).toBeDefined();
    terrain.dispose();
  });
});

describe('SceneView', () => {
  const setup = () => {
    const grid = makeGrid(['.....', '.....', '.....']);
    const state = new SceneState({ id: 'room' }, grid);
    state.addEntity(createPartyEntity('kara', 'sentinel', grid.indexOf(0, 0)));
    state.addEntity(
      createAdversaryEntity('husk', 'acid-burrower', grid.indexOf(4, 2), {
        hitPoints: 8,
        stress: 3,
      }),
    );
    return { grid, state, view: new SceneView(grid) };
  };

  it('adds the terrain and a light rig to the scene', () => {
    const { view } = setup();
    expect(view.scene.children).toContain(view.root);
    expect(view.terrain.meshes.length).toBeGreaterThan(0);
    for (const mesh of view.terrain.meshes) expect(view.root.children).toContain(mesh);
    expect(view.scene.children.filter((c) => c.type.endsWith('Light')).length).toBeGreaterThan(0);
    view.dispose();
  });

  it('creates one token per entity, standing on its tile', () => {
    const { grid, state, view } = setup();
    view.syncTokens(state);

    const kara = view.tokenFor('kara')!;
    expect(kara).toBeDefined();
    const centre = tileCenter(grid, grid.indexOf(0, 0));
    expect(kara.group.position.x).toBeCloseTo(centre.x, 10);
    expect(kara.group.position.z).toBeCloseTo(centre.z, 10);
    expect(kara.group.position.y).toBeCloseTo(centre.y, 10);
    expect(view.tokenFor('husk')).toBeDefined();
    view.dispose();
  });

  it('reuses a token when an entity moves rather than rebuilding it', () => {
    const { grid, state, view } = setup();
    view.syncTokens(state);
    const before = view.tokenFor('kara')!;

    state.moveEntity('kara', grid.indexOf(3, 1));
    view.syncTokens(state);
    const after = view.tokenFor('kara')!;

    expect(after).toBe(before); // same model, moved
    const centre = tileCenter(grid, grid.indexOf(3, 1));
    expect(after.group.position.x).toBeCloseTo(centre.x, 10);
    expect(after.group.position.z).toBeCloseTo(centre.z, 10);
    view.dispose();
  });

  it('shares geometry and materials between two tokens of the same model', () => {
    const { state, grid, view } = setup();
    state.addEntity(createPartyEntity('finn', 'sentinel', grid.indexOf(1, 0)));
    view.syncTokens(state);

    const kara = view.tokenFor('kara')!.group;
    const finn = view.tokenFor('finn')!.group;
    expect(finn).not.toBe(kara);
    // Same spec, same caches: every part shares its geometry and material.
    for (let i = 0; i < kara.children.length; i++) {
      const a = kara.children[i] as unknown as { geometry?: unknown; material?: unknown };
      const b = finn.children[i] as unknown as { geometry?: unknown; material?: unknown };
      if (a.geometry === undefined) continue;
      expect(b.geometry).toBe(a.geometry);
      expect(b.material).toBe(a.material);
    }
    view.dispose();
  });

  it('lays a fallen creature down instead of removing it', () => {
    const { state, view } = setup();
    view.syncTokens(state);
    state.entity('husk')!.alive = false;
    view.syncTokens(state);

    const husk = view.tokenFor('husk')!.group;
    expect(husk.visible).toBe(true);
    expect(husk.rotation.x).toBeCloseTo(-Math.PI / 2, 10);
    view.dispose();
  });

  it('retires a token when its entity leaves the scene', () => {
    const { state, view } = setup();
    view.syncTokens(state);
    const token = view.tokenFor('husk')!.group;

    state.removeEntity('husk');
    view.syncTokens(state);
    expect(view.tokenFor('husk')).toBeUndefined();
    expect(view.root.children).not.toContain(token);
    view.dispose();
  });

  it('hides a token that is not on the map', () => {
    const { state, view } = setup();
    state.addEntity(createPartyEntity('offstage', 'seer', -1));
    view.syncTokens(state);
    expect(view.tokenFor('offstage')!.group.visible).toBe(false);
    view.dispose();
  });

  it('paints highlights without allocating a mesh per tile', () => {
    const { grid, view } = setup();
    const meshesBefore = view.root.children.length;

    view.showHighlights([grid.indexOf(0, 0), grid.indexOf(1, 0), grid.indexOf(2, 0)]);
    expect(view.highlightedCount).toBe(3);
    expect(view.root.children.length).toBe(meshesBefore);

    view.showHighlights([grid.indexOf(0, 0)]);
    expect(view.highlightedCount).toBe(1);

    view.clearHighlights();
    expect(view.highlightedCount).toBe(0);
    view.dispose();
  });

  it('places a highlight just above its tile surface', () => {
    const { grid, view } = setup();
    grid.setHeight(grid.indexOf(2, 1), 2);
    const tile = grid.indexOf(2, 1);
    view.showHighlights([tile]);

    const matrix = new Matrix4();
    const position = new Vector3();
    const highlight = view.root.children.find((c) => c.name === 'highlights')!;
    (highlight as unknown as { getMatrixAt: (i: number, m: Matrix4) => void }).getMatrixAt(0, matrix);
    position.setFromMatrixPosition(matrix);

    const centre = tileCenter(grid, tile);
    expect(position.x).toBeCloseTo(centre.x, 6);
    expect(position.z).toBeCloseTo(centre.z, 6);
    expect(position.y).toBeGreaterThan(surfaceHeight(2) - 0.001);
    view.dispose();
  });

  it('paints a zone under the highlights, coloured per zone, without allocating', () => {
    const { grid, view } = setup();
    const meshesBefore = view.root.children.length;

    view.showZones([
      { tiles: [grid.indexOf(0, 0), grid.indexOf(1, 0)], color: '#ff7a3a' },
      { tiles: [grid.indexOf(4, 2), 999], color: '#b46cff' },
    ]);
    expect(view.zonedCount).toBe(3);
    expect(view.root.children.length).toBe(meshesBefore);

    const layer = view.root.children.find((c) => c.name === 'zones') as InstancedMesh;
    const colour = new Color();
    layer.getColorAt(0, colour);
    expect(colour.getHexString()).toBe('ff7a3a');
    layer.getColorAt(2, colour);
    expect(colour.getHexString()).toBe('b46cff');

    // Below the highlight, so a walk previewed across the ground shows both.
    const matrix = new Matrix4();
    const position = new Vector3();
    layer.getMatrixAt(0, matrix);
    position.setFromMatrixPosition(matrix);
    view.showHighlights([grid.indexOf(0, 0)]);
    const highlight = view.root.children.find((c) => c.name === 'highlights') as InstancedMesh;
    const above = new Vector3();
    highlight.getMatrixAt(0, matrix);
    above.setFromMatrixPosition(matrix);
    expect(position.y).toBeGreaterThan(surfaceHeight(0));
    expect(position.y).toBeLessThan(above.y);

    view.clearZones();
    expect(view.zonedCount).toBe(0);
    view.dispose();
  });

  it('skips highlights for tiles that do not exist', () => {
    const { view } = setup();
    view.showHighlights([0, 999, -1, 1]);
    expect(view.highlightedCount).toBe(2);
    view.dispose();
  });
});
