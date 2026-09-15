/**
 * Moving a placed creature.
 *
 * Kept apart from `session.ts`, which is pinned at its size, the way `card-edits.ts` is. A drag in
 * the editor runs this once per tile the pointer crosses; each carries the same `mergeKey`, so the
 * whole drag is one undo step that puts the creature back where it was picked up.
 */

import type { Encounter, ProjectDoc } from '../engine/scene/schema';
import type { Edit } from './session';

type Placement = Encounter['adversaries'][number];
type Position = Placement['position'];

function placementIn(project: ProjectDoc, sceneId: string, encounterId: string, placementId: string): Placement | undefined {
  return project.scenes
    .find((scene) => scene.id === sceneId)
    ?.encounters.find((encounter) => encounter.id === encounterId)
    ?.adversaries.find((placement) => placement.id === placementId);
}

const samePosition = (a: Position, b: Position): boolean => a.x === b.x && a.y === b.y && a.z === b.z;

/**
 * Put a placed creature somewhere else. Coalesces with the next move of the same creature, keeping
 * the position it started from, so undo returns it there however far it was carried. A creature
 * that is not there, or a move to where it already stands, changes nothing.
 */
export function moveAdversary(sceneId: string, encounterId: string, placementId: string, to: Position): Edit {
  let from: Position | null = null;
  const target: Position = { ...to };
  const edit: Edit = {
    label: 'Move creature',
    mergeKey: `move-creature:${sceneId}:${placementId}`,
    apply(project) {
      from = null;
      const placement = placementIn(project, sceneId, encounterId, placementId);
      if (placement === undefined) return;
      from = placement.position;
      placement.position = { ...target };
    },
    undo(project) {
      const placement = placementIn(project, sceneId, encounterId, placementId);
      if (placement !== undefined && from !== null) placement.position = from;
    },
    absorb(other) {
      const next = (other as Edit & { __to?: Position }).__to;
      if (next === undefined) return false;
      delete target.z;
      Object.assign(target, next);
      return true;
    },
    isNoop() {
      return from === null || samePosition(from, target);
    },
  };
  (edit as Edit & { __to: Position }).__to = target;
  return edit;
}
