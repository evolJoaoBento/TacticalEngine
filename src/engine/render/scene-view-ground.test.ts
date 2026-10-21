/**
 * Kinds of ground drawn in an imported material (`scene-view.ts`, `setSurfaces`): every cell of a kind that names a
 * material drawn in it once its maps are in - its own colours meanwhile, and again once the material is gone - and
 * still in it after the ground is rebuilt.
 */

import { expect, it } from 'vitest';
import { Texture, type Material, type Mesh } from 'three';
import { TileGrid } from '../grid/grid';
import { TerrainPalette, terrain } from '../grid/terrain';
import { SceneView } from './scene-view';
import { SurfaceLibrary } from './surface-library';
import { paintGround } from './ground-surfaces';
import type { TerrainMesh } from './terrain-mesh';
import type { SurfaceMaterial } from './tile-surface';

const paving = { id: 'paving', name: 'Paving', maps: { color: 'c', normalHeight: 'n', orm: 'o' }, parallax: true, size: 1, depth: 0.06, normalScale: 1, roughness: 1, tint: 0 };

it('draws a kind of ground in its material once the maps are in, keeps it through a rebuild, and lets it go', async () => {
  const palette = new TerrainPalette([terrain('floor', { color: '#5d8a4a', surface: 'paving' }), terrain('mud', { color: '#6b6350' })]);
  const grid = new TileGrid({ width: 4, height: 2, palette });
  grid.setTerrain(1, 1);
  const view = new SceneView(grid);
  const library = new SurfaceLibrary(() => Promise.resolve(new Texture()));
  library.add(paving);
  view.setSurfaces(library);
  // Asked for, not here yet: the kind's own colours.
  expect(view.paintedGround()).toEqual([]);
  await new Promise((settle) => setTimeout(settle, 0));
  expect(view.paintedGround()).toEqual(['floor']);
  const floor = view.root.getObjectByName('terrain:floor') as Mesh;
  // The ground's own material of it, reading the mesh's vertex colours for its tint.
  expect(floor.material).toBe(library.groundMaterialFor('paving'));
  expect(floor.material).not.toBe(library.materialFor('paving'));
  expect((floor.material as Material).vertexColors).toBe(true);
  // A kind that sets its own repeat is drawn at it.
  const sized = new TerrainPalette([terrain('floor', { color: '#5d8a4a', surface: 'paving', surfaceSize: 3 }), terrain('mud', { color: '#6b6350' })]);
  paintGround({ drawn: [floor] } as unknown as TerrainMesh, sized, library);
  expect(floor.material).toBe(library.groundMaterialFor('paving', 3));
  expect((floor.material as SurfaceMaterial).userData.surfaceUniforms.uSize.value).toBe(3);
  // Rebuilt - an edit to the ground - and painted again.
  view.rebuildTerrain();
  expect(view.paintedGround()).toEqual(['floor']);
  // The material gone, its own colours back - never the library's material disposed by the ground.
  library.remove('paving');
  expect(view.paintedGround()).toEqual([]);
  expect((view.root.getObjectByName('terrain:floor') as Mesh).material).not.toBe(library.groundMaterialFor('paving'));
});
