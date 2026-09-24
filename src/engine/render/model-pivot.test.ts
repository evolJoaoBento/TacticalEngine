/**
 * Where an imported model is held from: seated on its base (the default), or by the file's own
 * origin when its asset says `pivot: 'file'` - the choice in the Models panel.
 */

import { describe, it, expect } from 'vitest';
import { Box3, BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { TileGrid } from '../grid/grid';
import { TerrainPalette, terrain } from '../grid/terrain';
import { SceneState, createPartyEntity } from '../scene/state';
import { AssetLibrary, modelAssetSchema } from './assets';
import { DEFAULT_LAYOUT, placementCentre, tileCenter } from './layout';
import { SceneView } from './scene-view';
import { buildTileModels } from './tile-models';
import type { BuiltModel } from './procedural/build';

/** A 2-tile box modelled well away from its file's own origin: its middle at (3, 5, -2). */
function offCentre(): Group {
  const template = new Group();
  const mesh = new Mesh(new BoxGeometry(2, 2, 2));
  mesh.position.set(3, 5, -2);
  template.add(mesh);
  return template;
}

async function viewOf(pivot?: 'file'): Promise<{ view: SceneView; library: AssetLibrary; grid: TileGrid; standing: () => { x: number; z: number; feet: number } }> {
  const library = new AssetLibrary(() => Promise.resolve(offCentre()), [modelAssetSchema.parse({ id: 'cube', url: '/cube.glb', ...(pivot === undefined ? {} : { pivot }) })]);
  library.request('cube');
  await Promise.resolve();
  await Promise.resolve();
  const grid = new TileGrid({ width: 5, height: 3 });
  const state = new SceneState({ id: 'room' }, grid);
  state.addEntity(createPartyEntity('kara', 'sentinel', grid.indexOf(1, 1)));
  const view = new SceneView(grid, { assets: library, modelForEntity: () => 'cube' });
  view.syncTokens(state);
  const standing = (): { x: number; z: number; feet: number } => {
    const token = view.tokenFor('kara')!;
    token.group.updateMatrixWorld(true);
    const box = new Box3().setFromObject(token.group.children[0]!);
    return { x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2, feet: box.min.y };
  };
  return { view, library, grid, standing };
}

describe("a model's pivot", () => {
  it('is ignored unless asked for: the model is seated, centred on its tile with its feet on the ground', async () => {
    const { view, grid, standing } = await viewOf();
    const centre = tileCenter(grid, grid.indexOf(1, 1));
    const at = standing();
    expect(at.x).toBeCloseTo(centre.x, 6);
    expect(at.z).toBeCloseTo(centre.z, 6);
    expect(at.feet).toBeCloseTo(centre.y, 6);
    view.dispose();
  });

  it('is kept when the asset says so: the file origin goes on the middle of the tile, and the model stands where it was built', async () => {
    const { view, grid, standing } = await viewOf('file');
    const centre = tileCenter(grid, grid.indexOf(1, 1));
    const at = standing();
    expect(at.x).toBeCloseTo(centre.x + 3, 6);
    expect(at.z).toBeCloseTo(centre.z - 2, 6);
    // Its feet a unit below its middle, which was modelled five up.
    expect(at.feet).toBeCloseTo(centre.y + 4, 6);
    view.dispose();
  });

  it('changes as soon as the setting does, without the file being fetched again', async () => {
    const { view, library, grid, standing } = await viewOf();
    const centre = tileCenter(grid, grid.indexOf(1, 1));
    library.retune(modelAssetSchema.parse({ id: 'cube', url: '/cube.glb', pivot: 'file' }));
    expect(standing().x).toBeCloseTo(centre.x + 3, 6);
    library.retune(modelAssetSchema.parse({ id: 'cube', url: '/cube.glb' }));
    expect(standing().x).toBeCloseTo(centre.x, 6);
    view.dispose();
  });

  it('is `base` or `file`, and nothing else', () => {
    expect(modelAssetSchema.safeParse({ id: 'a', url: '/a.glb', pivot: 'middle' }).success).toBe(false);
    // Left out, it says nothing: a model on the default is written as it always was.
    expect('pivot' in modelAssetSchema.parse({ id: 'a', url: '/a.glb' })).toBe(false);
  });

  it("leaves a wall that keeps its own pivot where its file puts it, rather than moving it to an edge", () => {
    const kinds = new TerrainPalette([
      terrain('floor', { name: 'Floor' }),
      terrain('stone', { name: 'Stone Wall', model: 'slab', scale: 1, structure: 'wall' }),
    ]);
    const grid = new TileGrid({ width: 3, height: 3, palette: kinds });
    grid.pieces = [{ x: 1, y: 1, level: 0, rotation: 0, index: kinds.require('stone') }];
    const slab = (pivot?: 'file') => (id: string): BuiltModel => {
      const group = new Group();
      const mesh = new Mesh(new BoxGeometry(1, 1, 0.3), new MeshBasicMaterial());
      mesh.position.y = 0.5;
      group.add(mesh);
      return { group, spec: { id, ...(pivot === undefined ? {} : { pivot }) } as BuiltModel['spec'], named: new Map(), hooks: new Map() };
    };
    const middleZ = (pivot?: 'file'): number => {
      const mesh = buildTileModels(grid, DEFAULT_LAYOUT, slab(pivot)).find((g) => g.name === 'pieces:stone')!.children.find((c) => c instanceof InstancedMesh) as InstancedMesh;
      const at = new Matrix4();
      mesh.getMatrixAt(0, at);
      mesh.geometry.computeBoundingBox();
      return mesh.geometry.boundingBox!.clone().applyMatrix4(at).getCenter(new Vector3()).z;
    };
    const cell = placementCentre(grid, DEFAULT_LAYOUT, { x: 1, y: 1, z: 0 }).z;
    // Seated, a wall goes to the edge its box stands on; held by its own pivot, it stays put.
    expect(middleZ()).toBeCloseTo(cell - 0.35, 6);
    expect(middleZ('file')).toBeCloseTo(cell, 6);
  });
});
