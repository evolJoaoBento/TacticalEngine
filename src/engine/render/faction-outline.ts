/**
 * The line round an enemy: its silhouette, and nothing inside it.
 *
 * A token used to say which side it was on with a coloured disc at its feet - a pancake, in
 * the user's word for it. It lay flat, so a low camera lost it, and under an imported model
 * it was a plate the thing appeared to stand in. The same fact is a line round the creature
 * now, in its faction's colour.
 *
 * **Masked, not merely layered.** An inverted hull alone floods a creature: pushing back
 * faces along their normals sends them in front of the model wherever the surface folds
 * inward, and an imported model is nothing but folds. So the model is drawn into the stencil
 * buffer first - no colour, no depth - and the pushed copy only where the stencil is not set,
 * which is the difference between "usually outside" and "outside".
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

/**
 * The blue whoever is selected is drawn in.
 *
 * The same blue their HUD card is edged in, so the board and the cards point at the same
 * person. It used to be a ring on the ground that breathed to catch the eye; the line round
 * them says it without a second thing to draw, and follows them as they walk for free.
 */
export const SELECTED_COLOR = '#69d2ff';

/** How far the rim stands out past the silhouette, in world units. A line, not a halo. */
export const OUTLINE_WIDTH = 0.02;

/**
 * How much of a colour is left when nothing is pointing at it.
 *
 * A board of enemies all lit at full strength is a board with nothing picked out on it, so
 * the line sits back until the pointer finds it. Derived rather than written down as a
 * second hex, so every side dims by the same amount and there is one colour per faction to
 * keep in step instead of two.
 */
const DIM = 0.55;

/** A colour scaled toward black: the same hue, further away. */
export function dim(color: string, amount = DIM): string {
  const c = new Color(color).multiplyScalar(amount);
  return `#${c.getHexString()}`;
}

/**
 * Re-colour the line already round a model, and answer whether anything changed.
 *
 * The mask is left alone: it paints nothing, and its only job is to say where the model is.
 * Only the rim carries a colour, and swapping its material is a cache lookup - every enemy
 * at rest shares one, and the one the pointer is on shares another.
 */
export function recolourOutline(model: Object3D, color: string): boolean {
  const rim = model.children.find((child) => child.name === OUTLINE_NAME) as Mesh | undefined;
  if (rim === undefined) return false;
  const wanted = rimMaterial(OUTLINE_WIDTH, color);
  // Mid-flash the line is somebody else's for a moment: what it goes back to changes, and it does not.
  if (rim.userData['beforeFlash'] !== undefined) {
    rim.userData['beforeFlash'] = wanted;
    return false;
  }
  if (rim.material === wanted) return false;
  rim.material = wanted;
  return true;
}

/**
 * Bring one creature's line up to full strength and put every other back to its resting dim.
 *
 * Lives here rather than in the view because every part of it is this module's: which colour
 * a side is, what dim means, and which mesh carries it.
 */
export function litOutlines(
  tokens: Iterable<[string, { group: Object3D }]>,
  tile: number | null,
  selected: string | null,
  read: (id: string) => { tile: number; faction: string } | null,
  colors: Readonly<Record<string, string>>,
): string | null {
  const seen = [...tokens].map(([id, token]) => {
    const of = read(id);
    return { id, group: token.group, of: of === null ? null : { tile: of.tile, color: colors[of.faction] ?? DEFAULT_FACTION_COLORS['neutral']! } };
  });
  const lit = tile === null ? null : (seen.find((t) => t.of?.tile === tile)?.id ?? null);
  for (const t of seen) {
    if (t.of === null) continue;
    // Selected wins over pointed at: the blue says who is being played, and the pointer is
    // only ever a moment. A creature both selected and under the pointer stays blue.
    recolourOutline(t.group, t.id === selected ? SELECTED_COLOR : t.id === lit ? t.of.color : dim(t.of.color));
  }
  return lit;
}

/** How much wider than its resting width a flashed line is drawn, so it reads as a flare and not a recolour. */
export const FLASH_WIDTH = 2.5;

/**
 * Burn the line round a model in another colour for a moment, and hand back what puts it right.
 *
 * What it was before is remembered on the mesh, so a second flash on top of the first does not
 * remember the flash as the colour to go back to, and a recolour that arrives mid-flash - the
 * pointer finding the creature, a selection changing - changes what it goes back to rather than
 * cutting the flash short. Nothing to flash is nothing to undo.
 */
export function flashOutline(model: Object3D, color: string): () => void {
  const rim = model.children.find((child) => child.name === OUTLINE_NAME) as Mesh | undefined;
  if (rim === undefined) return () => {};
  const flash = rimMaterial(OUTLINE_WIDTH * FLASH_WIDTH, color);
  if (rim.userData['beforeFlash'] === undefined) rim.userData['beforeFlash'] = rim.material;
  rim.material = flash;
  return () => {
    // A later flash owns the line now, and will put it right itself.
    if (rim.material !== flash || rim.userData['beforeFlash'] === undefined) return;
    rim.material = rim.userData['beforeFlash'] as MeshBasicMaterial;
    delete rim.userData['beforeFlash'];
  };
}

/** Whether a model carries a line at all, so a caller can tell a miss from a no-op. */
export function hasOutline(model: Object3D): boolean {
  return model.children.some((child) => child.name === OUTLINE_NAME);
}

/** Show or hide the pair, for a line that is only drawn while something is pointed at. */
export function showOutline(model: Object3D, visible: boolean): void {
  for (const child of model.children) {
    if (child.name === OUTLINE_NAME || child.name === MASK_NAME) child.visible = visible;
  }
}

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
function rimMaterial(width: number, color: string, seeThrough = false): MeshBasicMaterial {
  const key = `${width}|${color}|${seeThrough}`;
  let material = rims.get(key);
  if (material === undefined) {
    material = new MeshBasicMaterial({
      color: new Color(color),
      side: BackSide,
      // Seen through what stands in front of it, for the thing the pointer is on: a door at
      // the back of a room is half behind a wall, and knowing what you are about to reach
      // for is the point of rimming it. Safe only because the mask is doing the real work -
      // the rim still cannot draw inside the silhouette, so this shows the shape through a
      // wall without washing the thing itself pale.
      depthTest: !seeThrough,
      depthWrite: !seeThrough,
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
export function outline(model: Object3D, key: string, color: string, visible = true, seeThrough = false): Mesh[] {
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
    // A see-through rim draws after the room rather than before it: with no depth test it
    // has to come last to show over a wall, where a depth-tested one comes first and lets
    // the model cover its middle.
    [OUTLINE_NAME, rimMaterial(OUTLINE_WIDTH, color, seeThrough), seeThrough ? 998 : -1],
  ] as const) {
    const mesh = new Mesh(hull, material);
    mesh.name = name;
    mesh.renderOrder = order;
    // An object's line is only drawn while the pointer is on it, so it is built dark; a
    // creature's is always on. Both are built once and shown or hidden thereafter.
    mesh.visible = visible;
    // Casting would put a pushed-out copy through the shadow pass as well, which reads as a
    // creature with a second, larger shadow.
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // Invisible to every ray. The hover rim this replaces hid on `OUTLINE_LAYER`, which a
    // raycaster ignores; these sit on layer 0 so the editor's camera draws them, and that
    // same choice would otherwise put them in front of every pick. A rim is the model pushed
    // outward, so it reaches past the thing it rims: picking would quietly grow a margin of
    // empty space round every object, and `objectUnder` could answer with the rim itself.
    mesh.raycast = () => {};
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
