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
import { mapExtent, surfaceHeight, tileCenter } from './layout';
import { SceneView, hueOf } from './scene-view';
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

  it('has a sun that casts, with a shadow camera the whole room fits inside', () => {
    const { grid, view } = setup();
    const sun = view.sunlight!;
    expect(sun.castShadow).toBe(true);
    // Every tile's centre is inside the shadow camera's box, or the far edge
    // of a big room would be lit as if nothing stood on it.
    const extent = mapExtent(grid);
    expect(sun.shadow.camera.right).toBeGreaterThanOrEqual(extent.radius);
    expect(sun.shadow.camera.top).toBeGreaterThanOrEqual(extent.radius);
    expect(-sun.shadow.camera.left).toBeGreaterThanOrEqual(extent.radius);
    expect(-sun.shadow.camera.bottom).toBeGreaterThanOrEqual(extent.radius);
    // And the floor is what catches the shadow, the walls what throw it.
    for (const mesh of view.terrain.meshes) {
      expect(mesh.receiveShadow).toBe(true);
      expect(mesh.castShadow).toBe(true);
    }
    view.dispose();
  });

  it('rings the selected tile, breathes while it is there, and goes away for nobody', () => {
    const { grid, view } = setup();
    const ring = view.root.children.find((c) => c.name === 'selection')!;
    expect(ring.visible).toBe(false);

    const tile = grid.indexOf(2, 1);
    grid.setHeight(tile, 1);
    view.showSelection(tile);
    expect(view.selectionAt).toBe(tile);
    expect(ring.visible).toBe(true);
    const centre = tileCenter(grid, tile);
    expect(ring.position.x).toBeCloseTo(centre.x, 6);
    expect(ring.position.z).toBeCloseTo(centre.z, 6);
    expect(ring.position.y).toBeGreaterThan(surfaceHeight(1));

    // Breathing changes the size a little and the place not at all.
    const before = ring.scale.x;
    view.tick(0.3);
    expect(ring.scale.x).not.toBe(before);
    expect(Math.abs(ring.scale.x - 1)).toBeLessThan(0.1);
    expect(ring.position.x).toBeCloseTo(centre.x, 6);

    view.showSelection(-1);
    expect(ring.visible).toBe(false);
    expect(view.selectionAt).toBe(-1);
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
    // The engine's truth is already there; the token walks. Once it has, it is there too.
    expect(view.glidingCount).toBe(1);
    view.settle();
    expect(view.glidingCount).toBe(0);
    const centre = tileCenter(grid, grid.indexOf(3, 1));
    expect(after.group.position.x).toBeCloseTo(centre.x, 10);
    expect(after.group.position.z).toBeCloseTo(centre.z, 10);
    view.dispose();
  });

  it('walks a token along the path it took, a hop per tile, and arrives exactly', () => {
    const { grid, state, view } = setup();
    view.syncTokens(state);
    const kara = view.tokenFor('kara')!;
    // Round the corner: east two, then south one.
    const path = [grid.indexOf(0, 0), grid.indexOf(1, 0), grid.indexOf(2, 0), grid.indexOf(2, 1)];
    state.moveEntity('kara', grid.indexOf(2, 1));
    view.walk('kara', path);
    view.syncTokens(state);

    // Still where it was, on the tick it left.
    const from = tileCenter(grid, grid.indexOf(0, 0));
    expect(kara.group.position.x).toBeCloseTo(from.x, 6);

    // Two thirds of the way in time is the corner tile, not a point on the
    // straight line from start to finish.
    view.tick(0.16 * 2);
    const corner = tileCenter(grid, grid.indexOf(2, 0));
    expect(kara.group.position.x).toBeCloseTo(corner.x, 3);
    expect(kara.group.position.z).toBeCloseTo(corner.z, 3);

    // Mid-tile it is a little off the ground: the hop.
    view.tick(0.08);
    expect(kara.group.position.y).toBeGreaterThan(corner.y + 0.05);

    view.tick(1);
    const to = tileCenter(grid, grid.indexOf(2, 1));
    expect(kara.group.position.x).toBeCloseTo(to.x, 10);
    expect(kara.group.position.y).toBeCloseTo(to.y, 10);
    expect(kara.group.position.z).toBeCloseTo(to.z, 10);
    expect(view.glidingCount).toBe(0);
    view.dispose();
  });

  it('walks the selection ring with the selected token, and leaves it on the tile', () => {
    const { grid, state, view } = setup();
    view.syncTokens(state);
    const to = grid.indexOf(3, 0);
    state.moveEntity('kara', to);
    view.syncTokens(state);
    view.showSelection(to);
    const ring = view.root.children.find((c) => c.name === 'selection')!;

    view.tick(0.1);
    const kara = view.tokenFor('kara')!;
    expect(ring.position.x).toBeCloseTo(kara.group.position.x, 6);
    expect(ring.position.x).toBeLessThan(tileCenter(grid, to).x);

    view.tick(2);
    expect(ring.position.x).toBeCloseTo(tileCenter(grid, to).x, 6);
    view.dispose();
  });

  it('flings a thrown token: quicker, higher, and straight', () => {
    const { grid, state, view } = setup();
    view.syncTokens(state);
    const husk = view.tokenFor('husk')!;
    state.moveEntity('husk', grid.indexOf(2, 2));
    view.throwBack('husk');
    view.syncTokens(state);

    view.tick(0.1);
    const from = tileCenter(grid, grid.indexOf(4, 2));
    const to = tileCenter(grid, grid.indexOf(2, 2));
    // Past halfway already at four tenths of the time (a throw slows into its
    // landing), and well off the ground.
    expect(husk.group.position.x).toBeLessThan((from.x + to.x) / 2);
    expect(husk.group.position.y).toBeGreaterThan(to.y + 0.25);
    view.tick(0.2);
    expect(husk.group.position.x).toBeCloseTo(to.x, 10);
    expect(view.glidingCount).toBe(0);
    view.dispose();
  });

  it('puts a token straight down when told to snap, and never walks a new one', () => {
    const { grid, state, view } = setup();
    view.syncTokens(state);
    state.moveEntity('kara', grid.indexOf(3, 2));
    view.syncTokens(state, { snap: true });
    expect(view.glidingCount).toBe(0);
    const at = tileCenter(grid, grid.indexOf(3, 2));
    expect(view.tokenFor('kara')!.group.position.x).toBeCloseTo(at.x, 10);

    state.addEntity(createPartyEntity('finn', 'nightwalker', grid.indexOf(1, 2)));
    view.syncTokens(state);
    expect(view.glidingCount).toBe(0);
    view.dispose();
  });

  it('lets a token that left the scene go, mid-walk', () => {
    const { grid, state, view } = setup();
    view.syncTokens(state);
    state.moveEntity('husk', grid.indexOf(1, 1));
    view.syncTokens(state);
    expect(view.glidingCount).toBe(1);
    state.removeEntity('husk');
    view.syncTokens(state);
    expect(view.glidingCount).toBe(0);
    expect(view.tokenFor('husk')).toBeUndefined();
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

  it('lays a fallen creature down instead of removing it - falling, not snapping', () => {
    const { state, view } = setup();
    view.syncTokens(state);
    state.entity('husk')!.alive = false;
    view.syncTokens(state);

    const husk = view.tokenFor('husk')!.group;
    expect(husk.visible).toBe(true);
    // Still upright on the tick it fell; part-way down after a little; flat after the fall.
    expect(husk.rotation.x).toBeCloseTo(0, 6);
    expect(view.reactingCount).toBe(1);
    view.tick(0.2);
    expect(husk.rotation.x).toBeLessThan(-0.05);
    expect(husk.rotation.x).toBeGreaterThan(-Math.PI / 2);
    view.tick(1);
    expect(husk.rotation.x).toBeCloseTo(-Math.PI / 2, 10);
    expect(view.reactingCount).toBe(0);

    // And gets up again, the same way round.
    state.entity('husk')!.alive = true;
    view.syncTokens(state);
    view.tick(0.2);
    expect(husk.rotation.x).toBeLessThan(-0.05);
    view.tick(1);
    expect(husk.rotation.x).toBeCloseTo(0, 10);
    view.dispose();
  });

  it('draws a creature first seen lying as lying, and settles a fall on demand', () => {
    const { grid, state, view } = setup();
    state.entity('husk')!.alive = false;
    view.syncTokens(state);
    expect(view.tokenFor('husk')!.group.rotation.x).toBeCloseTo(-Math.PI / 2, 10);
    expect(view.reactingCount).toBe(0);

    state.addEntity(createPartyEntity('finn', 'nightwalker', grid.indexOf(1, 2)));
    view.syncTokens(state);
    state.entity('finn')!.alive = false;
    view.syncTokens(state);
    expect(view.reactingCount).toBe(1);
    view.settle();
    // A load snaps: the body is simply where the save left it.
    state.entity('finn')!.alive = true;
    view.syncTokens(state, { snap: true });
    expect(view.reactingCount).toBe(0);
    expect(view.tokenFor('finn')!.group.rotation.x).toBeCloseTo(0, 10);
    state.entity('finn')!.alive = false;
    view.syncTokens(state, { snap: true });
    expect(view.reactingCount).toBe(0);
    expect(view.tokenFor('finn')!.group.rotation.x).toBeCloseTo(-Math.PI / 2, 10);
    view.dispose();
  });

  it('flinches when struck: a swell and a lean, gone by the end', () => {
    const { state, view } = setup();
    view.syncTokens(state);
    const husk = view.tokenFor('husk')!.group;
    view.flinch('husk');
    expect(view.reactingCount).toBe(1);
    view.tick(0.1);
    expect(husk.scale.x).toBeGreaterThan(1.05);
    expect(husk.rotation.z).not.toBe(0);
    view.tick(1);
    expect(husk.scale.x).toBeCloseTo(1, 10);
    expect(husk.rotation.z).toBeCloseTo(0, 10);
    expect(view.reactingCount).toBe(0);

    // Nobody to flinch is nothing started.
    view.flinch('nobody');
    expect(view.reactingCount).toBe(0);
    view.dispose();
  });

  it('lets the fall win over a flinch landing at the same time', () => {
    const { state, view } = setup();
    view.syncTokens(state);
    state.entity('husk')!.alive = false;
    view.syncTokens(state);
    view.flinch('husk');
    view.tick(1);
    expect(view.tokenFor('husk')!.group.rotation.x).toBeCloseTo(-Math.PI / 2, 10);
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

  it('spins a colour from a word that three can read, the same one each time', () => {
    const { view } = setup();
    const a = hueOf('in-shadow');
    expect(a).toBe(hueOf('in-shadow'));
    expect(a).not.toBe(hueOf('shadowed'));
    // Parsed, not silently white: the failure mode of an `hsl()` string with
    // the wrong separators.
    const parsed = new Color().set(a);
    expect(parsed.getHexString()).not.toBe('ffffff');
    expect(parsed.getHexString()).toBe(a.slice(1));
    view.showZones([{ tiles: [0], color: a }]);
    const layer = view.root.children.find((c) => c.name === 'zones') as InstancedMesh;
    const drawn = new Color();
    layer.getColorAt(0, drawn);
    expect(drawn.getHexString()).toBe(a.slice(1));
    view.dispose();
  });

  it('skips highlights for tiles that do not exist', () => {
    const { view } = setup();
    view.showHighlights([0, 999, -1, 1]);
    expect(view.highlightedCount).toBe(2);
    view.dispose();
  });
});
