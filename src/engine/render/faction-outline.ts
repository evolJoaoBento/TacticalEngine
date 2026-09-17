/**
 * The line round an enemy: its silhouette, and nothing inside it.
 *
 * A token used to say which side it was on with a coloured disc at its feet - a pancake, in
 * the user's word for it. It lay flat, so a low camera lost it, and under an imported model
 * it was a plate the thing appeared to stand in. The same fact is a line round the creature
 * now, in its faction's colour.
 *
 * **Why this is not just an inverted hull.** The first attempt was: a copy of the model,
 * back faces only, pushed out along its normals, the way `toon.ts` draws the hover rim. That
 * works on a box and fails on a creature. Pushing along a normal sends a back face outward,
 * and wherever the surface folds inward - every crevice of a 14k-triangle imported model -
 * the pushed copy comes out *in front of* the model's own face. The result was the whole
 * creature flooded red with the model showing through in patches. No width fixes it; the
 * hull is genuinely nearer the camera there, so no depth test saves it either.
 *
 * So the rim is masked instead of merely layered. The model's shape is drawn first into the
 * stencil buffer alone - no colour, no depth - and the pushed copy is then drawn only where
 * the stencil is *not* set. Inside the silhouette the rim cannot be drawn at all, whatever
 * the geometry does, which is the difference between "usually outside" and "outside".
 *
 * Two meshes per outlined thing, both sharing one geometry:
 *
 * - the mask, at `renderOrder -2`, marking where the model is on screen;
 * - the rim, at `renderOrder -1`, drawn where the mask is not, then the model over both.
 *
 * Two things this must not do, both learned from the tests that pin them:
 *
 * - It must not give every token its own geometry. Two tokens of one model share their
 *   parts down to the buffers, and a hull merged per token would quietly undo that for a
 *   room of twenty. The hulls are cached, so a room of husks merges one.
 * - It must not sit on `OUTLINE_LAYER`. That layer is the hover rim's, and the editor's
 *   camera is told not to draw it, so a faction rim there would be invisible in the one mode
 *   where creatures are placed. On layer 0 it is drawn by the play camera, the editor's and
 *   the thumbnail renderer's alike, with no toggle to keep in step.
 */

import {
  AlwaysStencilFunc,
  BackSide,
  BufferGeometry,
  Color,
  DoubleSide,
  KeepStencilOp,
  Mesh,
  MeshBasicMaterial,
  NotEqualStencilFunc,
  Object3D,
  ReplaceStencilOp,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { OUTLINE_LAYER, smoothHull } from './toon';

/**
 * The colour each side is drawn in.
 *
 * Lives here rather than in `scene-view.ts` because this is what the colour is now *for*: it
 * was the fill of a disc under a token, and it is the line round one.
 */
export const DEFAULT_FACTION_COLORS: Readonly<Record<string, string>> = {
  party: '#f6c453',
  adversary: '#c0524a',
  neutral: '#8ea3b0',
};

/** How far the rim stands out past the silhouette, in world units. A line, not a halo. */
export const OUTLINE_WIDTH = 0.02;

/** What the two meshes are called, so a later hull leaves them out and a test can find them. */
export const OUTLINE_NAME = 'faction-outline';
export const MASK_NAME = 'faction-outline-mask';

/** Which bit of the stencil buffer this claims. One is enough: the mask is cleared each frame. */
const STENCIL_REF = 1;

/**
 * The material that marks where the model is, and paints nothing.
 *
 * `colorWrite` off and `depthWrite` off: it exists only to set the stencil. `depthTest` off
 * as well, so the footprint is marked whether or not a wall stands in front - the rim does
 * its own depth test, so a hidden creature's line is hidden by the wall and not by the mask.
 */
let marker: MeshBasicMaterial | undefined;
function maskMaterial(): MeshBasicMaterial {
  marker ??= new MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
    depthTest: false,
    // Both faces. An imported model is not a closed shell - every shipped one declares its
    // material double-sided, and a wing or a fin is a single sheet - so a front-face mask
    // marked nothing wherever a back face was toward the camera, and the rim drew there.
    // That is the red that traced every fold: the mask has to cover the footprint whichever
    // way the surface happens to point.
    side: DoubleSide,
    stencilWrite: true,
    stencilRef: STENCIL_REF,
    stencilFunc: AlwaysStencilFunc,
    stencilZPass: ReplaceStencilOp,
  });
  return marker;
}

const rims = new Map<string, MeshBasicMaterial>();

/**
 * The rim: back faces pushed out along their normals, drawn only where the mask is not.
 *
 * Cached by width and colour, so every enemy on the board shares one material and every
 * friend another.
 */
function rimMaterial(width: number, color: string): MeshBasicMaterial {
  const key = `${width}|${color}`;
  let material = rims.get(key);
  if (material === undefined) {
    material = new MeshBasicMaterial({
      color: new Color(color),
      side: BackSide,
      stencilWrite: true,
      stencilRef: STENCIL_REF,
      stencilFunc: NotEqualStencilFunc,
      stencilFail: KeepStencilOp,
      stencilZFail: KeepStencilOp,
      stencilZPass: KeepStencilOp,
    });
    const push = width.toFixed(4);
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n\ttransformed += normalize( normal ) * ${push};`,
      );
    };
    material.customProgramCacheKey = () => `silhouette:${push}`;
    rims.set(key, material);
  }
  return material;
}

/**
 * Every mesh under `model`, merged into one closed geometry in the model's own space.
 *
 * A rim per part would draw every seam between parts, so they are merged first and closed
 * once. The model's own transform is left out: the meshes hang on the model and inherit it.
 */
function silhouetteOf(model: Object3D): BufferGeometry | null {
  model.updateWorldMatrix(true, true);
  const toLocal = model.matrixWorld.clone().invert();
  const parts: BufferGeometry[] = [];
  model.traverse((child) => {
    const mesh = child as Mesh;
    // Never a rim of a rim, and never a mask of a mask. The hover rim is known by its layer;
    // these two are on layer 0 with everything else, so they are known by name.
    if (!mesh.isMesh || mesh.name === OUTLINE_NAME || mesh.name === MASK_NAME) return;
    if (mesh.layers.isEnabled(OUTLINE_LAYER)) return;
    const position = mesh.geometry.attributes['position'];
    if (position === undefined) return;
    const part = new BufferGeometry();
    part.setAttribute('position', position);
    if (mesh.geometry.index !== null) part.setIndex(mesh.geometry.index);
    // The rim is pushed along `normal`, so the hull must carry one. Taken from the file
    // where there is one - a glTF's normals are better than any recomputed here - and
    // worked out only when there is not, so that every part offers the same attributes and
    // `mergeGeometries` will take them.
    const normal = mesh.geometry.attributes['normal'];
    if (normal === undefined) part.computeVertexNormals();
    else part.setAttribute('normal', normal);
    // Flattened before it joins the others. `mergeGeometries` answers null unless every
    // geometry agrees - same attributes, and all indexed or none - and a creature is built
    // from both kinds at once.
    parts.push((part.index === null ? part : part.toNonIndexed()).applyMatrix4(toLocal.clone().multiply(mesh.matrixWorld)));
  });
  if (parts.length === 0) return null;
  // One mesh is already one silhouette, and it keeps the file's own normals. Welding it
  // would cost more than everything else here put together: an imported creature runs to
  // half a million triangles, and `mergeVertices` over a million and a half vertices - once
  // per model, synchronously - is what froze the Models panel into drawing 21 of 34
  // pictures. Nothing is gained by it either; the merge exists to close the seams between
  // the parts of a procedural model, and a single mesh has none.
  if (parts.length === 1) return parts[0]!;
  const merged = mergeGeometries(parts);
  // Null when the parts cannot be reconciled. No rim, rather than an exception: a line round
  // a creature is a thing you notice missing, not one worth a dead view.
  return merged === null ? null : smoothHull(merged);
}

/** Hulls by what was merged, so a room of one creature merges once. */
const hulls = new Map<string, BufferGeometry | null>();

/**
 * Put a silhouette round `model` in `color`, and answer its two meshes - the mask and the
 * rim - or an empty list when there was nothing to draw round.
 *
 * Idempotent: a model that already carries one keeps the one it has, so a resync does not
 * stack rims on a token that only moved.
 */
export function outline(model: Object3D, key: string, color: string): Mesh[] {
  const standing = model.children.filter((child) => child.name === OUTLINE_NAME || child.name === MASK_NAME);
  if (standing.length > 0) return standing as Mesh[];

  let hull = hulls.get(key);
  if (hull === undefined) {
    hull = silhouetteOf(model);
    hulls.set(key, hull);
  }
  if (hull === null) return [];

  const made: Mesh[] = [];
  for (const [name, material, order] of [
    [MASK_NAME, maskMaterial(), -2],
    [OUTLINE_NAME, rimMaterial(OUTLINE_WIDTH, color), -1],
  ] as const) {
    const mesh = new Mesh(hull, material);
    mesh.name = name;
    mesh.renderOrder = order;
    // Casting would put a pushed-out copy through the shadow pass as well, which reads as a
    // creature with a second, larger shadow.
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    model.add(mesh);
    made.push(mesh);
  }
  return made;
}

/**
 * Forget one cached hull.
 *
 * An imported model is a placeholder until its file arrives, and the hull merged from the
 * placeholder is not the hull of what lands. The view calls this when a file turns up.
 */
export function forgetOutline(key: string): void {
  hulls.delete(key);
  hulls.delete(`thumb:${key}`);
}

/** Forget every cached hull. For a test that rebuilds the world between cases. */
export function forgetOutlines(): void {
  hulls.clear();
}
