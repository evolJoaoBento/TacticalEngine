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
 * so the editor never draws them and no raycast ever lands on one. There is one
 * pair per thing, round the whole of it rather than round each part, and they are
 * kept: pointing at the same thing twice does not build it twice.
 */

import { BufferGeometry, Mesh, type MeshBasicMaterial, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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
   * Two for the thing entire, not two for each part of it. Every mesh under the target
   * is merged into one geometry in the target's own space and closed once, so what is
   * rimmed is the outside silhouette and no interior seam is drawn. One is the ink
   * rim's twin in white: depth-tested, so all that shows of it is the edge past that
   * silhouette, which is what an outline is. The other is the same edge, drawn only
   * where something nearer already stands, so it is where a wall hides the thing — faint, so what
   * covers it stays legible through it, and absent entirely where the thing is in
   * plain view.
   *
   * Per mesh this could not work: a door's own front parts stand in front of its back
   * ones, so the second rim passed its depth test across the middle and filled the door
   * rather than edging it.
   *
   * Hung on the target, so it moves, turns and hides with it, and goes when it goes.
   * The merged hull is the pose it was built in, which is what a door, a chest or a
   * pillar needs; something that animates would want its rim rebuilt.
   */
  private rimsFor(target: Object3D): Mesh[] {
    const kept = this.rims.get(target);
    if (kept !== undefined) return kept;
    const made: Mesh[] = [];
    const silhouette = this.silhouetteOf(target);
    if (silhouette !== null) {
      const coats: [MeshBasicMaterial, number][] = [
        // The edge: the hull pushed out and drawn with the room, so the thing's own faces
        // cover its middle and all that shows is the ring past its silhouette.
        [outlineMaterial(WIDTH, '#ffffff'), -1],
        // The same edge where a wall is nearer than the thing, and nothing where it is not.
        [xrayMaterial(WIDTH, '#ffffff', GHOST), 999],
      ];
      for (const [material, order] of coats) {
        const rim = new Mesh(silhouette, material);
        rim.name = 'spotlight';
        rim.layers.set(OUTLINE_LAYER);
        rim.castShadow = false;
        rim.receiveShadow = false;
        rim.visible = false;
        rim.renderOrder = order;
        target.add(rim);
        made.push(rim);
      }
    }
    this.rims.set(target, made);
    return made;
  }

  /**
   * Every mesh under `target`, as one closed geometry in the target's own space.
   *
   * Each part is taken with its own place in the thing baked in, so a door's bands sit
   * where they sit; the target's own transform is left out, because the rim hangs on the
   * target and inherits it. Null when there is nothing to rim.
   */
  private silhouetteOf(target: Object3D): BufferGeometry | null {
    target.updateWorldMatrix(true, true);
    const toLocal = target.matrixWorld.clone().invert();
    const parts: BufferGeometry[] = [];
    target.traverse((child) => {
      const mesh = child as Mesh;
      // Not a rim of a rim: the ink hulls are meshes too, and they are on the layer.
      if (!mesh.isMesh || mesh.layers.isEnabled(OUTLINE_LAYER)) return;
      const part = new BufferGeometry();
      part.setAttribute('position', mesh.geometry.getAttribute('position'));
      if (mesh.geometry.index !== null) part.setIndex(mesh.geometry.index);
      parts.push(part.applyMatrix4(toLocal.clone().multiply(mesh.matrixWorld)));
    });
    if (parts.length === 0) return null;
    return smoothHull(parts.length === 1 ? parts[0]! : mergeGeometries(parts));
  }
}
