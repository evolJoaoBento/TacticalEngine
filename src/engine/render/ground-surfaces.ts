/**
 * Kinds of ground drawn in an imported material (`TerrainType.surface`; `surface-library.ts`), for `SceneView`: every
 * cell of a kind that names one drawn in it once its maps are in, the kind's own colours meanwhile.
 *
 * The ground is one mesh per kind (`terrain-mesh.ts`, `terrain:<id>`), so a kind is drawn in a material by giving its
 * mesh the library's ground material (`groundMaterialFor`) - shared, and never the ground's to dispose: the ground's
 * own is kept beside the mesh (`userData.plain`), is what `TerrainMesh.dispose` frees, and is put back when the
 * material goes. The material's UVs come from world position, so the mesh needs none. Its vertex colours - the kind's
 * colour, a cell's tint, blended across corners as the plain ground is - are what the material's tint takes
 * (`TileSurface.tint`); at none, the material's own colour. A kind that sets its own repeat (`surfaceSize`) gets the
 * library's material at that repeat.
 */

import type { Material } from 'three';
import type { TerrainPalette } from '../grid/terrain';
import type { SurfaceLibrary } from './surface-library';
import type { TerrainMesh } from './terrain-mesh';

/** Each drawn kind of ground in its material, or back in its own colours. */
export function paintGround(terrain: TerrainMesh, palette: TerrainPalette, surfaces: SurfaceLibrary | null): void {
  for (const mesh of terrain.drawn) {
    const plain = (mesh.userData['plain'] as Material | undefined) ?? (mesh.material as Material);
    mesh.userData['plain'] = plain;
    const index = palette.indexOf(mesh.name.slice('terrain:'.length));
    const kind = index < 0 ? undefined : palette.at(index);
    const surface = kind?.surface;
    // At the kind's own repeat, when it sets one.
    const painted = surface !== undefined && surfaces?.has(surface) === true ? surfaces.groundMaterialFor(surface, kind!.surfaceSize) : null;
    mesh.material = painted ?? plain;
  }
}

/** The kinds of ground drawn in an imported material right now, by id. */
export function paintedGround(terrain: TerrainMesh): string[] {
  return terrain.drawn.filter((mesh) => mesh.userData['plain'] !== undefined && mesh.material !== mesh.userData['plain']).map((mesh) => mesh.name.slice('terrain:'.length));
}
