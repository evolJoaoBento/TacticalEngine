/**
 * Moving what stands in a room: a placed creature, a prop, an object, a party start.
 *
 * Kept apart from `session.ts`, which is pinned at its size, the way `card-edits.ts` is. The editor
 * carries a thing for as long as the pointer is held and runs one of these when it lets go, so a
 * whole carry is one undo step that puts it back where it was picked up. Each finds its thing afresh
 * whenever it runs, so an undo or a redo lands on the same one however the list round it has moved.
 */

import type { Deco, Interactable, ProjectDoc, SceneDoc } from '../engine/scene/schema';
import type { Edit } from './session';

type Position = Deco['position'];

/** Reads and writes one thing's position. */
interface Slot {
  get(): Position;
  set(at: Position): void;
}

const samePosition = (a: Position, b: Position): boolean => a.x === b.x && a.y === b.y && a.z === b.z;

/**
 * An edit that moves one thing. Nothing there, or a move to where it already stands, changes
 * nothing and leaves no undo step.
 */
function relocate(label: string, sceneId: string, find: (scene: SceneDoc) => Slot | undefined, to: Position): Edit {
  const slot = (project: ProjectDoc): Slot | undefined => {
    const scene = project.scenes.find((s) => s.id === sceneId);
    return scene === undefined ? undefined : find(scene);
  };
  const target: Position = { ...to };
  let from: Position | null = null;
  return {
    label,
    apply(project) {
      const at = slot(project);
      from = at === undefined ? null : { ...at.get() };
      at?.set({ ...target });
    },
    undo(project) {
      if (from !== null) slot(project)?.set(from);
    },
    isNoop() {
      return from === null || samePosition(from, target);
    },
  };
}

/** Put a placed creature somewhere else. */
export function moveAdversary(sceneId: string, encounterId: string, placementId: string, to: Position): Edit {
  return relocate('Move creature', sceneId, (scene) => {
    const placement = scene.encounters.find((e) => e.id === encounterId)?.adversaries.find((p) => p.id === placementId);
    return placement === undefined ? undefined : { get: () => placement.position, set: (at) => { placement.position = at; } };
  }, to);
}

/**
 * Put an object somewhere else, facing where it was turned to.
 *
 * Not through `relocate`, for the reason `moveDeco` is not: a door turned in its own
 * doorway hangs where it hung and the document is not the same, so that is an edit and
 * an undo step. Left without a facing, it moves and keeps the one it had.
 */
export function moveInteractable(sceneId: string, id: string, to: Position, rotation?: number): Edit {
  const target: Position = { ...to };
  const find = (project: ProjectDoc): Interactable | undefined =>
    project.scenes.find((s) => s.id === sceneId)?.interactables.find((i) => i.id === id);
  let before: { position: Position; rotation: number } | null = null;
  return {
    label: 'Move object',
    apply(project) {
      const object = find(project);
      before = object === undefined ? null : { position: { ...object.position }, rotation: object.rotation };
      if (object === undefined) return;
      object.position = { ...target };
      if (rotation !== undefined) object.rotation = rotation;
    },
    undo(project) {
      const object = find(project);
      if (object === undefined || before === null) return;
      object.position = before.position;
      object.rotation = before.rotation;
    },
    isNoop() {
      if (before === null) return true;
      const turned = rotation !== undefined && Math.abs(rotation - before.rotation) > 1e-9;
      return samePosition(before.position, target) && !turned;
    },
  };
}

/**
 * Put a prop somewhere else, facing where it was turned to. Props have no ids, so one is named by
 * its place in the scene's list, which a move does not change: the one a click finds on a tile is
 * the last placed there.
 *
 * Not through `relocate`, whose idea of "nothing changed" is the position alone: a prop turned on
 * the spot stands where it stood and the document is not the same, so that is an edit and an undo
 * step. Left without a facing, it moves and keeps the one it had.
 */
export function moveDeco(sceneId: string, index: number, to: Position, rotation?: number): Edit {
  const target: Position = { ...to };
  const find = (project: ProjectDoc): Deco | undefined => project.scenes.find((s) => s.id === sceneId)?.decos[index];
  let before: { position: Position; rotation: number } | null = null;
  return {
    label: 'Move prop',
    apply(project) {
      const deco = find(project);
      before = deco === undefined ? null : { position: { ...deco.position }, rotation: deco.rotation };
      if (deco === undefined) return;
      deco.position = { ...target };
      if (rotation !== undefined) deco.rotation = rotation;
    },
    undo(project) {
      const deco = find(project);
      if (deco === undefined || before === null) return;
      deco.position = before.position;
      deco.rotation = before.rotation;
    },
    isNoop() {
      if (before === null) return true;
      const turned = rotation !== undefined && Math.abs(rotation - before.rotation) > 1e-9;
      return samePosition(before.position, target) && !turned;
    },
  };
}

/** Put one of the party's starting places somewhere else, by its place in the list. A start has no Z. */
export function moveSpawn(sceneId: string, index: number, to: Position): Edit {
  return relocate('Move party start', sceneId, (scene) => {
    if (scene.spawns[index] === undefined) return undefined;
    return { get: () => scene.spawns[index]!, set: (at) => { scene.spawns[index] = { x: at.x, y: at.y }; } };
  }, { x: to.x, y: to.y });
}
