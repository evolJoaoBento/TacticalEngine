/**
 * The white rim round the thing under the pointer.
 *
 * A door at the back of a room is half behind a wall, and a player needs to know
 * what they are about to reach for — so what is pointed at is rimmed in white,
 * and the rim is drawn through whatever stands in front of it. It reads as the
 * whole shape of the thing, not the part of it that happens to be in view.
 *
 * Only the rim ignores the depth of the room, never the pointing: a press finds
 * what it finds by looking, so an object entirely behind a wall is not lit by
 * waving at the wall. The caller does that test; this only draws.
 *
 * The rims are inverted hulls like the ink ones (`toon.ts`), on the same layer,
 * so the editor never draws them and no raycast ever lands on one. They hang on
 * the meshes they belong to, and are kept per object: pointing at the same thing
 * twice does not build it twice.
 */

import { Mesh, type BufferGeometry, type MeshBasicMaterial, type Object3D } from 'three';
import { OUTLINE_LAYER, outlineMaterial, smoothHull, xrayMaterial } from './toon';

/** World units the white rim stands out from what it is drawn round: the ink rim's own width. */
const WIDTH = 0.022;
/** How much of the ghost is seen through what hides it: enough to find, not enough to read as solid. */
const GHOST = 0.55;

export class Spotlight {
  /** What is lit now, and the rims hung on it. */
  private on: Object3D | null = null;
  private readonly rims = new WeakMap<Object3D, Mesh[]>();

  /** What the pointer is on, or null. Lighting what is already lit changes nothing. */
  show(target: Object3D | null): void {
    if (target === this.on) return;
    this.hide();
    if (target === null) return;
    this.on = target;
    for (const rim of this.rimsFor(target)) rim.visible = true;
  }

  /** Nothing is pointed at. */
  hide(): void {
    if (this.on === null) return;
    for (const rim of this.rims.get(this.on) ?? []) rim.visible = false;
    this.on = null;
  }

  /** What is lit, for a caller that wants to know. */
  get lit(): Object3D | null {
    return this.on;
  }

  /**
   * The rims for one thing, built the first time it is pointed at.
   *
   * Two per mesh. One is the ink rim's twin in white: depth-tested, so all that
   * shows of it is the edge past the thing's own silhouette, which is what an
   * outline is. The other is drawn only where something nearer already stands, so
   * it is the part of the thing a wall is hiding and nothing else — faint, so what
   * covers it stays legible through it, and absent entirely where the thing is in
   * plain view.
   *
   * Hung on the meshes themselves, so they move, turn and hide with what they rim,
   * and go when it goes without this holding on to anything the room threw away.
   */
  private rimsFor(target: Object3D): Mesh[] {
    const kept = this.rims.get(target);
    if (kept !== undefined) return kept;
    const made: Mesh[] = [];
    target.traverse((child) => {
      const mesh = child as Mesh;
      // Not a rim of a rim: the ink hulls are meshes too, and they are on the layer.
      if (!mesh.isMesh || mesh.layers.isEnabled(OUTLINE_LAYER)) return;
      const coats: [BufferGeometry, MeshBasicMaterial, number][] = [
        // The edge: a hull pushed out and drawn with the room, so the thing's own faces
        // cover its middle and all that shows is the ring past its silhouette.
        [smoothHull(mesh.geometry), outlineMaterial(WIDTH, '#ffffff'), -1],
        // The ghost: the thing's own shape, not a hair wider. Its faces sit at exactly
        // its own depth, so where it can be seen there is nothing nearer than itself and
        // it draws nothing; only a wall in front of it lets it through.
        [mesh.geometry, xrayMaterial(0, '#ffffff', GHOST, true), 999],
      ];
      for (const [geometry, material, order] of coats) {
        const rim = new Mesh(geometry, material);
        rim.name = 'spotlight';
        rim.layers.set(OUTLINE_LAYER);
        rim.castShadow = false;
        rim.receiveShadow = false;
        rim.visible = false;
        rim.renderOrder = order;
        mesh.add(rim);
        made.push(rim);
      }
    });
    this.rims.set(target, made);
    return made;
  }
}
