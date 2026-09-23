/**
 * The render layer runs headless.
 *
 * A `BufferGeometry` and an `InstancedMesh` are plain objects until a renderer
 * compiles them, so everything the adapter builds can be asserted on in node —
 * which is the whole reason to keep the geometry work out of the page.
 */

import { describe, it, expect } from 'vitest';
import { AnimationClip, Box3, BoxGeometry, Color, Group, Matrix4, Mesh, Vector3, type InstancedMesh, type Line, type LineSegments } from 'three';
import { InstancedMesh as InstancedMeshValue, MeshBasicMaterial, Object3D } from 'three';
import { TerrainPalette, terrain } from '../grid/terrain';
import { AssetLibrary, modelAssetSchema } from './assets';
import { TileGrid } from '../grid/grid';
import { BAND_COLOURS } from './path-bands';
import { SceneState, createAdversaryEntity, createPartyEntity } from '../scene/state';
import { DEFAULT_LAYOUT, mapExtent, spotToWorld, surfaceHeight, tileCenter } from './layout';
import { WALK_HOP, WALK_PER_TILE } from './glide';
import { SceneView, hueOf } from './scene-view';
import { OUTLINE_NAME, SELECTED_COLOR } from './faction-outline';
import { DEFAULT_TERRAIN_COLORS, buildTerrainMesh, tilesDrawn, topColorOf } from './terrain-mesh';

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

/** Every face of a mesh as its tile, its normal's y and the y of its three corners. */
function faces(terrain: ReturnType<typeof buildTerrainMesh>): { tile: number; up: number; ys: number[] }[] {
  const out: { tile: number; up: number; ys: number[] }[] = [];
  for (const mesh of terrain.meshes) {
    const positions = mesh.geometry.getAttribute('position');
    const normals = mesh.geometry.getAttribute('normal');
    for (let face = 0; face < positions.count / 3; face++) {
      out.push({
        tile: terrain.tileOf(mesh, face),
        up: normals.getY(face * 3),
        ys: [positions.getY(face * 3), positions.getY(face * 3 + 1), positions.getY(face * 3 + 2)],
      });
    }
  }
  return out;
}

describe('buildTerrainMesh', () => {
  it('draws the whole map in one mesh per terrain type', () => {
    const grid = makeGrid(['..#.', '.~#.', '....']);
    const terrain = buildTerrainMesh(grid);
    // Three types appear: floor, difficult, wall. Not four — nothing is 'cover'.
    expect(terrain.meshes).toHaveLength(3);
    expect(tilesDrawn(terrain)).toBe(grid.size);
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
    expect(tilesDrawn(large)).toBe(3600);
    small.dispose();
    large.dispose();
  });

  it('lays every tile\'s top at its surface height, and walls only where the ground drops', () => {
    const grid = makeGrid(['...', '.2.']);
    const terrain = buildTerrainMesh(grid);
    const all = faces(terrain);
    const tops = all.filter((f) => f.up > 0.5);
    const walls = all.filter((f) => f.up < 0.5);

    // Two triangles per tile, flat at the tile's own height.
    expect(tops).toHaveLength(grid.size * 2);
    for (const top of tops) {
      expect(top.tile).toBeGreaterThanOrEqual(0);
      for (const y of top.ys) expect(y).toBeCloseTo(surfaceHeight(grid.heightAt(top.tile)), 6);
    }
    // Ten edges of map round the outside (one of them the raised tile's own
    // south side) and the raised tile's three other sides: thirteen walls of
    // two triangles each. Nothing between two level tiles.
    expect(walls).toHaveLength(13 * 2);
    const raised = grid.indexOf(1, 1);
    const inner = walls.filter((w) => w.tile === raised && Math.min(...w.ys) > 0);
    // Three of the raised tile's walls stop at the neighbour's surface; the
    // fourth, off the map's edge, goes to the ground.
    expect(inner).toHaveLength(3 * 2);
    for (const wall of inner) expect(Math.min(...wall.ys)).toBeCloseTo(surfaceHeight(0), 6);
    terrain.dispose();
  });

  it('maps every face back to its tile, and a face that is not there to none', () => {
    const grid = makeGrid(['..#.', '.~#.']);
    const terrain = buildTerrainMesh(grid);
    const seen = new Set<number>();
    for (const face of faces(terrain)) seen.add(face.tile);
    expect(seen.size).toBe(grid.size);
    expect(seen.has(-1)).toBe(false);
    expect(terrain.tileOf(terrain.meshes[0]!, 99_999)).toBe(-1);
    terrain.dispose();
  });

  it('honours an authored tint, blends it into the ground beside it, and ignores a bad one', () => {
    const grid = makeGrid(['..']);
    const tints = ['#ff0000', 'not-a-colour'];
    const terrain = buildTerrainMesh(grid, { tints });
    const red = topColorOf(terrain, 0)!;
    const plain = topColorOf(terrain, 1)!;
    // The red tile is red where it is on its own and halfway to the floor
    // where it meets the next tile, so its top reads mostly red and the
    // neighbour, whose bad tint fell back to the floor colour, catches some.
    expect(red.r).toBeGreaterThan(0.7);
    expect(red.r).toBeGreaterThan(plain.r);
    expect(plain.r).toBeLessThan(0.5);
    expect(plain.g).toBeGreaterThan(red.g);
    expect(DEFAULT_TERRAIN_COLORS['floor']).toBeDefined();
    terrain.dispose();
  });

  it('keeps a step sharp: nothing blends across a change of height', () => {
    const grid = makeGrid(['.2']);
    const terrain = buildTerrainMesh(grid, { tints: ['#ff0000', '#0000ff'] });
    const low = topColorOf(terrain, 0)!;
    const high = topColorOf(terrain, 1)!;
    expect(low.r).toBeCloseTo(new Color('#ff0000').r, 5);
    expect(low.b).toBeCloseTo(0, 5);
    expect(high.b).toBeCloseTo(new Color('#0000ff').b, 5);
    expect(high.r).toBeCloseTo(0, 5);
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

  it("draws a prop across the block it covers, as one prop and not a tile's worth repeated", () => {
    const { view } = setup();
    view.setDecos([
      { model: 'rock', position: { x: 0, y: 0 }, rotation: 0 },
      { model: 'rock', position: { x: 1, y: 1 }, rotation: 0, span: 3 },
    ]);
    const props = view.root.children.filter((child) => child.name === 'model:rock');
    // Two props, not one plus nine: a block is one thing drawn big, not a tile repeated over it.
    expect(props.length).toBe(2);
    const [one, big] = props as [typeof props[0], typeof props[0]];
    expect(one.scale.x).toBeCloseTo(1, 6);
    expect(big.scale.x).toBeCloseTo(3, 6);
    expect(big.scale.y).toBeCloseTo(3, 6);

    // And it stands over the middle of its block rather than over the tile it is anchored to: a
    // 3x3 at (1,1) covers (1,1)-(3,3), whose middle is (2,2), one tile south-east of the anchor.
    const tile = view.layout.tileSize;
    expect(big.position.x - one.position.x).toBeCloseTo(2 * tile, 5);
    expect(big.position.z - one.position.z).toBeCloseTo(2 * tile, 5);
  });

  it('draws an even block centred where its tiles meet, not on a tile', () => {
    const { view } = setup();
    view.setDecos([
      { model: 'rock', position: { x: 0, y: 0 }, rotation: 0 },
      { model: 'rock', position: { x: 0, y: 0 }, rotation: 0, span: 2 },
    ]);
    const [one, pair] = view.root.children.filter((child) => child.name === 'model:rock');
    const tile = view.layout.tileSize;
    // Half a tile south-east of the anchor's middle: the corner its four tiles share.
    expect(pair!.position.x - one!.position.x).toBeCloseTo(0.5 * tile, 5);
    expect(pair!.position.z - one!.position.z).toBeCloseTo(0.5 * tile, 5);
  });

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

  it('turns the selected creature\'s line blue, and gives it back for nobody', () => {
    // There was a ring on the ground that breathed to catch the eye. The line round them
    // says it instead: one thing to draw rather than two, and it follows them as they walk
    // without anything having to move it.
    const { state, view } = setup();
    view.syncTokens(state);
    const rim = (id: string): string =>
      ((view.tokenFor(id)!.group.children.find((c) => c.name === OUTLINE_NAME) as Mesh)
        .material as MeshBasicMaterial).color.getHexString();
    const resting = rim('kara');
    const tile = state.entity('kara')!.tile;

    view.showSelection(tile, 'kara');
    expect(view.selectionAt).toBe(tile);
    expect(rim('kara')).toBe(SELECTED_COLOR.slice(1));
    // Nobody else is blue: the point of the mark is that it picks one out.
    expect(rim('husk')).not.toBe(SELECTED_COLOR.slice(1));

    view.showSelection(-1);
    expect(view.selectionAt).toBe(-1);
    expect(rim('kara')).toBe(resting);
    view.dispose();
  });

  it('rebinds to another room: the ground, the sun and the overlays change, the view and its caches do not', () => {
    const { grid, state, view } = setup();
    view.syncTokens(state);
    const karaBefore = view.tokenFor('kara')!;
    view.showHighlights([grid.indexOf(0, 0)]);
    view.showZones([{ tiles: [grid.indexOf(1, 1)], color: '#ff7a3a' }]);
    view.showSelection(grid.indexOf(0, 0));
    view.showCursor(grid.indexOf(1, 0));
    expect(view.root.children.some((child) => child.name === 'cursor')).toBe(false); // the pointer draws nothing of its own
    const resources = view.resources;

    // A bigger room, with Quim arriving on a spawn and the husk left behind.
    const bigger = makeGrid(['........', '........', '........', '........', '........', '........']);
    const arrived = new SceneState({ id: 'hall' }, bigger);
    arrived.addEntity(createPartyEntity('kara', 'sentinel', bigger.indexOf(7, 5)));
    view.rebind(bigger, { decos: [] });

    expect(view.grid).toBe(bigger);
    expect(tilesDrawn(view.terrain)).toBe(bigger.size);
    expect(view.resources).toBe(resources);
    expect(view.highlightedCount).toBe(0);
    expect(view.zonedCount).toBe(0);
    expect(view.zoneEdgeSegments).toBe(0);
    expect(view.selectionAt).toBe(-1);
    expect(view.cursorAt).toBe(-1);
    // The sun reaches the whole of the new room.
    expect(view.sunlight!.shadow.camera.right).toBeGreaterThanOrEqual(mapExtent(bigger).radius);

    // Quim's token is the same one, put down where she now is with no walk
    // from the other room's coordinates; the husk is gone.
    view.syncTokens(arrived);
    expect(view.tokenFor('kara')).toBe(karaBefore);
    expect(view.glidingCount).toBe(0);
    const at = tileCenter(bigger, bigger.indexOf(7, 5));
    expect(karaBefore.group.position.x).toBeCloseTo(at.x, 10);
    expect(view.tokenFor('husk')).toBeUndefined();

    // The overlays grew with the room: every tile can be lit at once.
    const all = Array.from({ length: bigger.size }, (_, i) => i);
    view.showHighlights(all);
    expect(view.highlightedCount).toBe(bigger.size);
    view.showZones([{ tiles: all, color: '#b46cff' }]);
    expect(view.zonedCount).toBe(bigger.size);

    // And back to a smaller room, which fits in what there is.
    view.rebind(grid);
    expect(tilesDrawn(view.terrain)).toBe(grid.size);
    view.showHighlights([0, 1, 2]);
    expect(view.highlightedCount).toBe(3);
    view.dispose();
  });

  /** A view whose party wears an imported model with these clips, already loaded. */
  const imported = async (clips?: { idle?: string; walk?: string; hit?: string; fallen?: string }) => {
    const template = new Group();
    template.animations = [new AnimationClip('Survey', 1, []), new AnimationClip('Walk', 1, []), new AnimationClip('Run', 1, [])];
    const library = new AssetLibrary(
      () => Promise.resolve(template),
      [modelAssetSchema.parse({ id: 'fox', url: '/fox.glb', scale: 1, ...(clips === undefined ? {} : { clips }) })],
    );
    library.request('fox');
    await Promise.resolve();
    await Promise.resolve();
    const grid = makeGrid(['.....', '.....', '.....']);
    const state = new SceneState({ id: 'room' }, grid);
    state.addEntity(createPartyEntity('kara', 'sentinel', grid.indexOf(0, 0)));
    const view = new SceneView(grid, { assets: library, modelForEntity: () => 'fox' });
    view.syncTokens(state);
    return { grid, state, view };
  };

  it('rebuilds a token when the model it is drawn with changes under it', async () => {
    const library = new AssetLibrary(() => Promise.resolve(new Group()), [modelAssetSchema.parse({ id: 'fox', url: '/fox.glb', scale: 1 })]);
    library.request('fox');
    await Promise.resolve();
    await Promise.resolve();
    const grid = makeGrid(['.....', '.....', '.....']);
    const state = new SceneState({ id: 'room' }, grid);
    state.addEntity(createPartyEntity('kara', 'sentinel', grid.indexOf(2, 1)));
    let wanted = 'fox';
    const view = new SceneView(grid, { assets: library, modelForEntity: () => wanted });
    view.syncTokens(state);
    const before = view.tokenFor('kara')!;

    // Re-skinned where the document is written; the token standing there is the old one.
    wanted = 'husk';
    view.syncTokens(state);
    const after = view.tokenFor('kara')!;
    expect(after).not.toBe(before);
    // Put down where it stands, rather than walking in from wherever the old one was.
    const centre = tileCenter(grid, grid.indexOf(2, 1));
    expect(after.group.position.x).toBeCloseTo(centre.x, 6);
    expect(after.group.position.z).toBeCloseTo(centre.z, 6);
    expect(view.glidingCount).toBe(0);

    // And nothing changed is nothing rebuilt: the same id keeps the same token.
    view.syncTokens(state);
    expect(view.tokenFor('kara')).toBe(after);
    view.dispose();
  });

  it('stands an object with logic in the room even when it names no model', () => {
    const grid = makeGrid(['.....', '.....', '.....']);
    const view = new SceneView(grid);
    const objects = [
      { id: 'vault-door', kind: 'door', position: { x: 1, y: 1 }, model: null },
      { id: 'hoard', kind: 'chest', position: { x: 3, y: 1 }, model: null },
      { id: 'a-lever', kind: 'scripted', position: { x: 4, y: 1 }, model: null },
    ] as unknown as Parameters<typeof view.setObjects>[0];

    // In play: a door is a door and a chest is a chest, with no model named on either.
    view.setObjects(objects);
    view.setAuthoring(null);
    expect(view.root.getObjectByName('object:vault-door'), 'a door has a body').toBeDefined();
    expect(view.root.getObjectByName('object:hoard'), 'a chest has a body').toBeDefined();
    // A scripted object is whatever its author means it to be, so nothing is guessed.
    expect(view.root.getObjectByName('object:a-lever')).toBeUndefined();

    // Authoring it, the one with no body of its own is the one that gets the mark.
    view.setAuthoring({ id: 'room', name: '', encounters: [], spawns: [], interactables: objects, decos: [] } as never);
    expect(view.root.getObjectByName('object:a-lever'), 'the mark is for what nothing draws').toBeDefined();
    view.dispose();
  });

  it('draws an object with a body of its own in play, where nobody is authoring', () => {
    const grid = makeGrid(['.....', '.....', '.....']);
    const view = new SceneView(grid);
    const objects = [
      { id: 'strongbox', kind: 'chest', position: { x: 2, y: 1 }, model: 'crate', name: '', flavor: '', blocksMovement: true, effects: [], repeatable: false },
      { id: 'stair-up', kind: 'portal', position: { x: 4, y: 1 }, model: null, name: '', flavor: '', blocksMovement: true, effects: [], repeatable: false },
    ] as unknown as Parameters<typeof view.setObjects>[0];

    // Play: nothing is being authored, and the chest is still standing in the room.
    view.setObjects(objects);
    view.setAuthoring(null);
    const drawn = view.root.getObjectByName('object:strongbox');
    expect(drawn, 'an object with a model is drawn in play').toBeDefined();
    const centre = tileCenter(grid, grid.indexOf(2, 1));
    expect(drawn!.position.x).toBeCloseTo(centre.x, 6);
    expect(drawn!.position.z).toBeCloseTo(centre.z, 6);
    // A stair is a portal, and a portal has a body of its own now: naming no model is
    // not the same as having nothing to draw.
    expect(view.root.getObjectByName('object:stair-up')).toBeDefined();

    // Authoring it: the chest as itself, the stair as the mark an author takes hold of.
    view.setAuthoring({ id: 'room', name: '', encounters: [], spawns: [], interactables: objects, decos: [] } as never);
    expect(view.root.getObjectByName('object:strongbox')).toBeDefined();
    expect(view.root.getObjectByName('object:stair-up')).toBeDefined();
    view.dispose();
  });

  it('seats an imported model on its tile, and twice the size grows it where it stands', async () => {
    // A box modelled well away from its file's own origin, as an exported file often is.
    const template = new Group();
    const mesh = new Mesh(new BoxGeometry(2, 2, 2));
    mesh.position.set(3, 5, -2);
    template.add(mesh);
    const cube = (scale: number) => modelAssetSchema.parse({ id: 'cube', url: '/cube.glb', scale });
    const library = new AssetLibrary(() => Promise.resolve(template), [cube(1)]);
    library.request('cube');
    await Promise.resolve();
    await Promise.resolve();

    const grid = makeGrid(['.....', '.....', '.....']);
    const state = new SceneState({ id: 'room' }, grid);
    state.addEntity(createPartyEntity('kara', 'sentinel', grid.indexOf(1, 1)));
    const view = new SceneView(grid, { assets: library, modelForEntity: () => 'cube' });
    view.syncTokens(state);

    const centre = tileCenter(grid, grid.indexOf(1, 1));
    const standing = () => {
      const token = view.tokenFor('kara')!;
      token.group.updateMatrixWorld(true);
      const box = new Box3().setFromObject(token.group.children[0]!);
      return {
        middleX: (box.min.x + box.max.x) / 2,
        middleZ: (box.min.z + box.max.z) / 2,
        feet: box.min.y,
        height: box.max.y - box.min.y,
      };
    };

    // On its tile and on the ground, not hanging off wherever the artist's origin was.
    const small = standing();
    expect(small.middleX).toBeCloseTo(centre.x, 6);
    expect(small.middleZ).toBeCloseTo(centre.z, 6);
    expect(small.feet).toBeCloseTo(centre.y, 6);

    // Resized, it grows in place: same spot, same feet, twice as tall.
    library.retune(cube(2));
    const big = standing();
    expect(big.height).toBeCloseTo(small.height * 2, 6);
    expect(big.middleX).toBeCloseTo(centre.x, 6);
    expect(big.middleZ).toBeCloseTo(centre.z, 6);
    expect(big.feet).toBeCloseTo(centre.y, 6);

    // And nudged across the tile, for a model that should not stand in its own middle.
    library.retune(modelAssetSchema.parse({ id: 'cube', url: '/cube.glb', scale: 1, offsetX: 0.5, offsetY: -0.25 }));
    const nudged = standing();
    expect(nudged.middleX).toBeCloseTo(centre.x + 0.5 * DEFAULT_LAYOUT.tileSize, 6);
    expect(nudged.middleZ).toBeCloseTo(centre.z - 0.25 * DEFAULT_LAYOUT.tileSize, 6);
    expect(nudged.feet).toBeCloseTo(centre.y, 6);
    view.dispose();
  });

  it('plays the named idle, the walk while it walks, and the idle again when it has', async () => {
    const { grid, state, view } = await imported({ idle: 'Survey', walk: 'Run' });
    expect(view.modelSource('fox')).toBe('asset');
    expect(view.clipOf('kara')).toBe('Survey');
    state.moveEntity('kara', grid.indexOf(3, 0));
    view.syncTokens(state);
    expect(view.clipOf('kara')).toBe('Run');
    view.tick(0.2);
    expect(view.clipOf('kara')).toBe('Run');
    view.tick(2);
    expect(view.clipOf('kara')).toBe('Survey');
    // A throw is not a walk.
    state.moveEntity('kara', grid.indexOf(1, 2));
    view.throwBack('kara');
    view.syncTokens(state);
    expect(view.clipOf('kara')).toBe('Survey');
    view.settle();
    expect(view.clipOf('kara')).toBe('Survey');
    view.dispose();
  });

  it('plays the hit once and the fall to its last frame, and keeps playing where no clip is named', async () => {
    const { state, view } = await imported({ idle: 'Survey', hit: 'Walk', fallen: 'Run' });
    view.flinch('kara');
    expect(view.clipOf('kara')).toBe('Walk');
    view.tick(1);
    expect(view.clipOf('kara')).toBe('Survey');
    state.entity('kara')!.alive = false;
    view.syncTokens(state);
    expect(view.clipOf('kara')).toBe('Run');
    view.tick(2);
    expect(view.clipOf('kara')).toBe('Run');
    state.entity('kara')!.alive = true;
    view.syncTokens(state);
    expect(view.clipOf('kara')).toBe('Survey');
    view.dispose();

    // Nothing named: the first clip idles and nothing the view does changes it.
    const bare = await imported();
    expect(bare.view.clipOf('kara')).toBe('Survey');
    bare.view.flinch('kara');
    expect(bare.view.clipOf('kara')).toBe('Survey');
    bare.state.moveEntity('kara', bare.grid.indexOf(2, 2));
    bare.view.syncTokens(bare.state);
    expect(bare.view.clipOf('kara')).toBe('Survey');
    // And a procedural token has no clip to speak of.
    const { view: plain } = setup();
    plain.syncTokens(new SceneState({ id: 'r' }, makeGrid(['..'])));
    expect(plain.clipOf('kara')).toBeNull();
    bare.view.dispose();
    plain.dispose();
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

  it('walks a token along the path it took, facing the way it goes, and arrives exactly', () => {
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
    view.tick(WALK_PER_TILE * 2);
    const corner = tileCenter(grid, grid.indexOf(2, 0));
    expect(kara.group.position.x).toBeCloseTo(corner.x, 3);
    expect(kara.group.position.z).toBeCloseTo(corner.z, 3);

    // Along the first leg it faced east; round the corner, south. Its feet
    // stay on the ground the whole way.
    expect(kara.group.rotation.y).toBeCloseTo(Math.PI / 2, 6);
    view.tick(0.08);
    expect(kara.group.rotation.y).toBeCloseTo(0, 6);
    // On the ground, to within the rise of a step: a walking token bobs.
    expect(Math.abs(kara.group.position.y - corner.y)).toBeLessThanOrEqual(WALK_HOP + 1e-6);

    view.tick(1);
    const to = tileCenter(grid, grid.indexOf(2, 1));
    expect(kara.group.position.x).toBeCloseTo(to.x, 10);
    expect(kara.group.position.y).toBeCloseTo(to.y, 10);
    expect(kara.group.position.z).toBeCloseTo(to.z, 10);
    expect(view.glidingCount).toBe(0);
    view.dispose();
  });

  it('carries the blue with the selected token, because it hangs on it', () => {
    // The ring this replaced had to be walked along by `tick`, chasing whichever token was
    // gliding to the selected tile. The line is a child of the token, so it goes where the
    // token goes and there is no tracking left to get wrong.
    const { grid, state, view } = setup();
    view.syncTokens(state);
    const to = grid.indexOf(3, 0);
    state.moveEntity('kara', to);
    view.syncTokens(state);
    view.showSelection(to);

    const kara = view.tokenFor('kara')!;
    const rim = kara.group.children.find((c) => c.name === OUTLINE_NAME)!;
    expect((((rim as Mesh).material) as MeshBasicMaterial).color.getHexString()).toBe(SELECTED_COLOR.slice(1));
    view.tick(0.1);
    expect(rim.parent).toBe(kara.group);
    view.tick(2);
    expect(rim.parent).toBe(kara.group);
    view.dispose();
  });

  it('stands a token where the creature stands, not at the centre of its square', () => {
    const { grid, state, view } = setup();
    state.placeEntity('kara', 2.4, 1.3);
    view.syncTokens(state);
    const at = spotToWorld(grid, { x: 2.4, y: 1.3 });
    const kara = view.tokenFor('kara')!;
    expect(kara.group.position.x).toBeCloseTo(at.x, 10);
    expect(kara.group.position.z).toBeCloseTo(at.z, 10);
    expect(kara.group.position.x).not.toBeCloseTo(tileCenter(grid, grid.indexOf(2, 1)).x, 3);
    view.dispose();
  });

  it('holds a move that waits on a roll until the roll has been read, and then makes it', () => {
    const { grid, state, view } = setup();
    view.syncTokens(state);
    const kara = view.tokenFor('kara')!;
    const stood = kara.group.position.clone();
    const route = [{ x: 0, y: 0 }, { x: 2, y: 0 }];
    state.placeEntity('kara', 2, 0);
    view.walkAlong('kara', route, 0.75, true);

    // The card is up: drawn again and again, the token has not stirred, and nothing is gliding.
    for (let i = 0; i < 3; i++) {
      view.syncTokens(state, { reading: true });
      view.tick(0.5);
    }
    expect(view.glidingCount).toBe(0);
    expect(kara.group.position.distanceTo(stood)).toBeCloseTo(0, 10);

    // Accepted: it goes, along the line it was handed, as the jump it was.
    view.syncTokens(state, { reading: false });
    expect(view.glidingCount).toBe(1);
    view.tick(5);
    const to = spotToWorld(grid, { x: 2, y: 0 });
    expect(kara.group.position.x).toBeCloseTo(to.x, 10);
    expect(view.glidingCount).toBe(0);

    // A move that waits on nothing is not held by somebody else's roll being read.
    state.placeEntity('kara', 0, 0);
    view.walkAlong('kara', [{ x: 2, y: 0 }, { x: 0, y: 0 }]);
    view.syncTokens(state, { reading: true });
    expect(view.glidingCount).toBe(1);
    view.dispose();
  });

  it('flinches where the move ends when the blow came with the move, and at once when standing still', () => {
    const { state, view } = setup();
    view.syncTokens(state);
    // Standing: struck is struck.
    view.flinch('kara');
    expect(view.reactingCount).toBe(1);
    view.tick(5);
    expect(view.reactingCount).toBe(0);

    // A fall: the move and the wound arrive together, and the wound is the landing's.
    state.placeEntity('kara', 2, 0);
    view.walkAlong('kara', [{ x: 0, y: 0 }, { x: 2, y: 0 }], 0.75);
    view.flinch('kara');
    view.syncTokens(state);
    expect(view.glidingCount).toBe(1);
    expect(view.reactingCount).toBe(0);
    view.tick(0.1);
    expect(view.reactingCount).toBe(0);
    // Landed: now they flinch, once. Frame by frame, as a page draws it - one long tick would
    // land them and play the whole flinch in the same breath.
    for (let i = 0; i < 100 && view.glidingCount > 0; i++) view.tick(0.02);
    expect(view.glidingCount).toBe(0);
    expect(view.reactingCount).toBe(1);
    view.tick(5);
    expect(view.reactingCount).toBe(0);
    view.dispose();
  });

  it('walks a token along the line it was handed, and arrives at the spot at its end', () => {
    const { grid, state, view } = setup();
    view.syncTokens(state);
    const kara = view.tokenFor('kara')!;
    // One straight leg across the room to a spot off any centre.
    const route = [
      { x: 0, y: 0 },
      { x: 3.4, y: 1.7 },
    ];
    state.placeEntity('kara', 3.4, 1.7);
    view.walkAlong('kara', route);
    view.syncTokens(state);
    expect(view.glidingCount).toBe(1);
    const from = tileCenter(grid, grid.indexOf(0, 0));
    const to = spotToWorld(grid, { x: 3.4, y: 1.7 });

    // Halfway in time is halfway along the line, since it is one leg.
    const duration = WALK_PER_TILE * Math.hypot(3.4, 1.7);
    view.tick(duration / 2);
    expect(kara.group.position.x).toBeCloseTo((from.x + to.x) / 2, 3);
    expect(kara.group.position.z).toBeCloseTo((from.z + to.z) / 2, 3);

    view.tick(2);
    expect(kara.group.position.x).toBeCloseTo(to.x, 10);
    expect(kara.group.position.z).toBeCloseTo(to.z, 10);
    expect(kara.group.position.y).toBeCloseTo(to.y, 10);
    expect(view.glidingCount).toBe(0);
    view.dispose();
  });

  it('walks a step within the same tile rather than jumping it', () => {
    const { state, view } = setup();
    view.syncTokens(state);
    state.placeEntity('kara', 0.3, 0.2);
    view.syncTokens(state);
    expect(view.glidingCount).toBe(1);
    view.tick(2);
    expect(view.glidingCount).toBe(0);
    view.dispose();
  });

  it('marks the selected creature wherever they stand, not the square they are in', () => {
    const { state, view } = setup();
    state.placeEntity('kara', 1.4, 0.3);
    view.syncTokens(state);
    view.showSelection(state.entity('kara')!.tile, 'kara');
    const kara = view.tokenFor('kara')!;
    const rim = kara.group.children.find((c) => c.name === OUTLINE_NAME) as Mesh;
    expect((rim.material as MeshBasicMaterial).color.getHexString()).toBe(SELECTED_COLOR.slice(1));
    // Hung on the token, so it is off-centre exactly as she is.
    expect(rim.parent).toBe(kara.group);
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

  it('hangs a faction outline on every token it builds', () => {
    // The line round a creature says which side it is on, in place of the disc that used to
    // lie under one. It is built with the token, so if this is ever empty nothing is drawn
    // and the board goes back to having no faction cue at all - which is a thing that looks
    // exactly like the outline being broken, and is not the same bug.
    const { state, grid, view } = setup();
    state.addEntity(createAdversaryEntity('husk-1', 'husk', grid.indexOf(3, 3), { hitPoints: 4, stress: 4 }));
    view.syncTokens(state);
    for (const id of ['kara', 'husk-1']) {
      const group = view.tokenFor(id)!.group;
      const names = group.children.map((child) => child.name);
      expect(names, `${id}: ${names.join(', ')}`).toContain('faction-outline');
      expect(names, `${id}: ${names.join(', ')}`).toContain('faction-outline-mask');
    }
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

  it('lunges at whoever it swung at, and comes back to exactly where it stood', () => {
    const { grid, state, view } = setup();
    view.syncTokens(state);
    const kara = view.tokenFor('kara')!.group;
    const rest = kara.position.clone();
    // Quim at (0,0), the husk at (4,2): the lunge is east and a little south.
    view.lunge('kara', grid.indexOf(4, 2));
    expect(view.reactingCount).toBe(1);
    view.tick(0.12);
    expect(kara.position.x).toBeGreaterThan(rest.x + 0.1);
    expect(kara.position.z).toBeGreaterThan(rest.z);
    view.tick(1);
    expect(kara.position.x).toBeCloseTo(rest.x, 6);
    expect(kara.position.z).toBeCloseTo(rest.z, 6);
    expect(view.reactingCount).toBe(0);

    // Settling mid-lunge brings it straight back.
    view.lunge('kara', grid.indexOf(4, 2));
    view.tick(0.1);
    view.settle();
    expect(kara.position.x).toBeCloseTo(rest.x, 6);
    // Nowhere to lunge at is nothing started.
    view.lunge('kara', -1);
    view.lunge('kara', grid.indexOf(0, 0));
    expect(view.reactingCount).toBe(0);
    view.dispose();
  });

  it('lunges without disturbing a walk under it', () => {
    const { grid, state, view } = setup();
    view.syncTokens(state);
    const kara = view.tokenFor('kara')!.group;
    state.moveEntity('kara', grid.indexOf(3, 0));
    view.syncTokens(state);
    view.lunge('kara', grid.indexOf(3, 2));
    view.tick(2);
    const to = tileCenter(grid, grid.indexOf(3, 0));
    expect(kara.position.x).toBeCloseTo(to.x, 6);
    expect(kara.position.z).toBeCloseTo(to.z, 6);
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

  it('draws the part past one move in amber when a run would get there', () => {
    const { view } = setup();
    const line = view.root.children.find((c) => c.name === 'path') as Line;
    view.showPath(
      [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ],
      [
        { x: 2, y: 0 },
        { x: 3, y: 0 },
      ],
      true,
    );
    const colors = line.geometry.getAttribute('color');
    // The walk is in its band's colour; the part past one move is not a distance, it is a verdict.
    expect(colors.getY(0)).toBeCloseTo(new Color(BAND_COLOURS.melee).g, 5);
    // Green tells amber from red: both are all red.
    expect(colors.getY(6)).toBeCloseTo(new Color('#ffc14d').g, 5);
    view.dispose();
  });

  it('draws the hover path on the ground in two colours, and clears it', () => {
    const { view } = setup();
    const line = view.root.children.find((c) => c.name === 'path') as Line;
    expect(line.visible).toBe(false);
    view.showPath(
      [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ],
      [
        { x: 2, y: 0 },
        { x: 3, y: 0 },
      ],
    );
    // Two tiles cut at half a tile is five points, then two more beyond.
    expect(view.pathPointCount).toBe(7);
    expect(line.visible).toBe(true);
    expect(line.geometry.drawRange.count).toBe(7);
    const colors = line.geometry.getAttribute('color');
    // Banded by how far along the walk each point is: the first tile is Melee, the second Very
    // Close, so the line changes colour on the way without anything being said about it.
    // Close, not equal: the buffer is float32 and a colour is not, so the last bits differ.
    const at = (i: number) => [colors.getX(i), colors.getY(i), colors.getZ(i)];
    const band = (i: number, hex: string) => {
      const want = new Color(hex);
      [want.r, want.g, want.b].forEach((channel, c) => expect(at(i)[c]).toBeCloseTo(channel, 5));
    };
    band(0, BAND_COLOURS.melee);
    band(4, BAND_COLOURS.veryClose);
    expect(at(0)).not.toEqual(at(4));
    expect(colors.getX(6)).toBeCloseTo(new Color('#ff6a5c').r, 5);
    const positions = line.geometry.getAttribute('position');
    expect(positions.getY(0)).toBeGreaterThan(0);
    view.clearPath();
    expect(view.pathPointCount).toBe(0);
    expect(line.visible).toBe(false);
    view.dispose();
  });

  it('borders the lit ground along its edge, so a walk reads as an area', () => {
    const { grid, view } = setup();
    view.showHighlights([grid.indexOf(1, 1)]);
    expect(view.highlightEdgeSegments).toBe(4);
    view.showHighlights([grid.indexOf(1, 1), grid.indexOf(2, 1)]);
    expect(view.highlightEdgeSegments).toBe(6);
    // A tile named twice is lit once and bordered once.
    view.showHighlights([grid.indexOf(1, 1), grid.indexOf(1, 1)]);
    expect(view.highlightedCount).toBe(1);
    expect(view.highlightEdgeSegments).toBe(4);
    view.clearHighlights();
    expect(view.highlightEdgeSegments).toBe(0);
    view.dispose();
  });

  it('outlines a zone along its edge, not round every tile, in the zone\'s colour', () => {
    const { grid, view } = setup();
    // One tile has four edges; two side by side share one, so six; three in an
    // L share two, so eight.
    view.showZones([{ tiles: [grid.indexOf(1, 1)], color: '#ff7a3a' }]);
    expect(view.zoneEdgeSegments).toBe(4);
    view.showZones([{ tiles: [grid.indexOf(1, 1), grid.indexOf(2, 1)], color: '#ff7a3a' }]);
    expect(view.zoneEdgeSegments).toBe(6);
    view.showZones([{ tiles: [grid.indexOf(1, 1), grid.indexOf(2, 1), grid.indexOf(1, 2)], color: '#ff7a3a' }]);
    expect(view.zoneEdgeSegments).toBe(8);
    // Two zones touching keep their own edges: they are different ground.
    view.showZones([
      { tiles: [grid.indexOf(1, 1)], color: '#ff7a3a' },
      { tiles: [grid.indexOf(2, 1)], color: '#b46cff' },
    ]);
    expect(view.zoneEdgeSegments).toBe(8);

    const edges = view.root.children.find((c) => c.name === 'zone-edges') as LineSegments;
    expect(edges.geometry.drawRange.count).toBe(16);
    const colour = edges.geometry.getAttribute('color');
    const drawn = new Color(colour.getX(8), colour.getY(8), colour.getZ(8));
    expect(drawn.getHexString()).toBe('b46cff');

    view.clearZones();
    expect(view.zoneEdgeSegments).toBe(0);
    view.dispose();
  });

  it('draws the overlays in a fixed order: ground, edge, walk', () => {
    const { view } = setup();
    const order = ['zones', 'zone-edges', 'highlights', 'highlight-edges', 'path'].map(
      (name) => view.root.children.find((c) => c.name === name)!.renderOrder,
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(order.length);
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

describe('a walk already under way', () => {
  it('is not begun again by a sync that lands while it is running', () => {
    const grid = makeGrid(['........', '........', '........']);
    const view = new SceneView(grid);

    const standing = new SceneState({ id: 'room' }, grid);
    standing.addEntity(createPartyEntity('walker', 'sentinel', grid.indexOf(0, 1)));
    view.syncTokens(standing);
    expect(view.glidingCount).toBe(0);

    // The engine puts the creature at the far end; the token has the journey to make.
    const moved = new SceneState({ id: 'room' }, grid);
    moved.addEntity(createPartyEntity('walker', 'sentinel', grid.indexOf(7, 1)));
    view.syncTokens(moved);
    expect(view.glidingCount).toBe(1);

    view.tick(0.2);
    const partway = view.tokenFor('walker')!.group.position.x;

    // Something unrelated arrives and syncs every token - which is what `assetChanged`
    // does when a model file lands. Mid-walk the token's last drawn spot is where it set
    // off and the entity is already at the far end, so this reads as a fresh move; without
    // the guard it starts the walk over, from the beginning, with the walk clip.
    view.syncTokens(moved);
    expect(view.glidingCount).toBe(1);
    expect(view.tokenFor('walker')!.group.position.x).toBe(partway);

    // And it still arrives, so `advanceGlides` keeps the ending and the idle after it.
    view.tick(5);
    expect(view.glidingCount).toBe(0);
    view.dispose();
  });
});

describe('a file the ground is waiting for', () => {
  it('redraws the ground when it lands, though nothing else in the room uses it', async () => {
    let arrived: (scene: Object3D) => void = () => {};
    const library = new AssetLibrary(
      () => new Promise<Object3D>((resolve) => { arrived = resolve; }),
      [modelAssetSchema.parse({ id: 'turf', url: '/turf.glb', scale: 1 })],
    );
    // A kind of ground drawn with the file, named before the view is built, and no
    // creature, prop or object anywhere that names the same id.
    const grid = new TileGrid({
      width: 2,
      height: 2,
      palette: new TerrainPalette([terrain('floor', { model: 'turf' })]),
    });
    const view = new SceneView(grid, { assets: library });

    const tileGroup = (): Group | undefined =>
      view.root.children.find((c) => c.name.startsWith('tiles:')) as Group | undefined;
    const instancedIn = (group: Group | undefined): boolean =>
      group !== undefined && group.children.some((c) => c instanceof InstancedMeshValue);

    // Built while the file is in flight: something stands there, and it is not instanced.
    expect(tileGroup()).toBeDefined();
    expect(instancedIn(tileGroup())).toBe(false);

    const model = new Group();
    model.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
    arrived(model);
    // The loader resolves, then the library notifies its listeners.
    await Promise.resolve();
    await Promise.resolve();

    // The ground was rebuilt from the file. Without the fix `assetChanged` returned
    // before reaching the tile layer, because no token, deco or object was waiting for
    // the same id - and the placeholders stayed on screen while the asset read as ready.
    expect(instancedIn(tileGroup())).toBe(true);
    expect(library.statusOf('turf')).toBe('ready');
    view.dispose();
  });
});
