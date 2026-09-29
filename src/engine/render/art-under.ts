/**
 * Which model a thing drawn on the board is made of, for the note that says how its art was made
 * (`game/art-provenance.ts`, `game/ui/AiNote.tsx`).
 *
 * Every model the view builds says so on its group (`named`: `userData.model`, and a `model:` name
 * unless it has one), as every tile-model group does (`tile-models.ts`) - on the group's data, where the
 * view's own renames (`token:`, `object:`, `authored-creature:`) cannot reach it. What a ray meets is
 * read back up to the nearest group that says (`modelOf`); plain ground is no model at all.
 */

import type { Object3D, Raycaster } from 'three';
import type { BuiltModel } from './procedural/build';

/** A built model, its group named for the model it is - unless it has a name - and the model kept on its data. */
export function named(built: BuiltModel, modelId: string): BuiltModel {
  if (built.group.name === '') built.group.name = `model:${modelId}`;
  built.group.userData['model'] = modelId;
  return built;
}

/**
 * The model a drawn thing belongs to: the nearest group above it that says (`userData.model`, or a
 * `model:` name); and for something hung beside a model rather than inside it - a creature's rim - the
 * model in the same top-level group.
 */
export function modelOf(object: Object3D, root: Object3D): string | null {
  let node: Object3D | null = object;
  let top: Object3D = object;
  while (node !== null && node !== root) {
    const tagged = node.userData['model'];
    if (typeof tagged === 'string') return tagged;
    if (node.name.startsWith('model:')) return node.name.slice('model:'.length);
    top = node;
    node = node.parent;
  }
  let found: string | null = null;
  top.traverse((child) => {
    const tagged = child.userData['model'];
    if (found === null && typeof tagged === 'string') found = tagged;
  });
  return found;
}

/** The model of the nearest of these a ray meets, unless the ground is nearer; null for nothing, or ground. */
export function artUnder(ray: Raycaster, drawn: readonly Object3D[], ground: readonly Object3D[], root: Object3D): string | null {
  const hit = ray.intersectObjects([...drawn], true).find((h) => h.object.visible);
  if (hit === undefined) return null;
  const floor = ray.intersectObjects([...ground], false)[0];
  if (floor !== undefined && floor.distance < hit.distance) return null;
  return modelOf(hit.object, root);
}
