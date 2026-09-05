/**
 * The demo scene, assembled from real content.
 *
 * Everything the browser entry point needs that is *not* a renderer, a camera or
 * an input handler — so it can be built and asserted on in node, and the page is
 * left holding only the parts that genuinely need a browser.
 *
 * The map is the legacy prototype's demo vault, imported through the same path a
 * project would take, and the adversaries are SRD stat blocks read out of the
 * vendored JSON.
 */

import adversaryJson from '../../tools/srd-sources/seansbox/adversaries.json';
import {
  importSeansboxAdversaries,
  type RawAdversary,
} from '../engine/content/srd/seansbox-adversaries';
import type { AdversaryDef } from '../engine/content/types';
import { NO_TILE, type TileGrid } from '../engine/grid/grid';
import { Pathfinder, tracePath, type ReachableField } from '../engine/grid/pathfinding';
import { gridFromScene, tileOf } from '../engine/scene/grid-from-scene';
import { importLegacyScene, type LegacyMap } from '../engine/scene/legacy-import';
import type { SceneDoc } from '../engine/scene/schema';
import {
  createPartyEntity,
  sceneStateFromScene,
  type Faction,
  type SceneState,
} from '../engine/scene/state';

/** Adversary stat blocks, keyed by content id. */
export const SRD_ADVERSARIES: ReadonlyMap<string, AdversaryDef> = new Map(
  importSeansboxAdversaries(adversaryJson as RawAdversary[]).defs.map((def) => [def.id, def]),
);

/**
 * The prototype's homebrew Hollow Husk has no SRD stat block, so the demo stands
 * the SRD's Acid Burrower in its place — the same substitution the end-to-end
 * combat test makes.
 */
export const DEMO_ADVERSARY_ID = 'acid-burrower';

/** How far a party member may move in one go, in movement points. */
export const DEMO_MOVE_BUDGET = 8;

export interface DemoScene {
  scene: SceneDoc;
  grid: TileGrid;
  state: SceneState;
  pathfinder: Pathfinder;
  /** The party member the player is moving. */
  leaderId: string;
}

/** Factions a mover walks through rather than around. */
const PASS_THROUGH: readonly Faction[] = ['party'];

/**
 * Build the demo from a legacy map document.
 *
 * The caller supplies the document so the browser and the tests can hand in the
 * same one without this module importing `legacy/`.
 */
export function buildDemoScene(map: LegacyMap): DemoScene {
  const imported = importLegacyScene(map);
  const scene = imported.scene;
  if (scene === null) throw new Error('the demo map could not be imported');

  const { grid } = gridFromScene(scene);
  const burrower = SRD_ADVERSARIES.get(DEMO_ADVERSARY_ID);
  if (burrower === undefined) throw new Error(`missing adversary "${DEMO_ADVERSARY_ID}"`);

  // Every placement in the legacy map asks for a Hollow Husk; map them all onto
  // the Burrower so the demo has something to fight.
  const stats = new Map<string, { id: string; hitPoints: number; stress: number }>();
  for (const encounter of scene.encounters) {
    for (const placement of encounter.adversaries) {
      stats.set(placement.adversary, {
        id: placement.adversary,
        hitPoints: burrower.hitPoints,
        stress: burrower.stress,
      });
    }
  }

  const { state } = sceneStateFromScene(scene, grid, {
    adversaries: stats,
    party: [
      createPartyEntity('kara', 'sentinel', NO_TILE),
      createPartyEntity('finn', 'nightwalker', NO_TILE),
    ],
  });

  // The vault door is shut in the authored map; open it so the demo has somewhere
  // to walk and something to reach.
  const door = scene.interactables.find((i) => i.kind === 'door');
  if (door !== undefined) {
    state.interactable(door.id).open = true;
    state.setInteractableBlocking(tileOf(grid, door.position), false);
  }

  return { scene, grid, state, pathfinder: new Pathfinder(grid), leaderId: 'kara' };
}

/** Tiles the leader can currently reach, as a movement preview. */
export function reachableTiles(demo: DemoScene, budget = DEMO_MOVE_BUDGET): ReachableField {
  const leader = demo.state.entity(demo.leaderId);
  const from = leader?.tile ?? NO_TILE;
  return demo.pathfinder.reachable(from, budget, {
    isBlocked: demo.state.blockedFor(demo.leaderId, PASS_THROUGH),
  });
}

export interface MoveResult {
  moved: boolean;
  /** Tiles stepped through, start included. Empty when nothing moved. */
  path: number[];
}

/**
 * Walk the leader to a tile if it is in reach.
 *
 * Returns the path so a caller can animate it; the state is updated immediately,
 * because the engine's truth should never wait on a tween.
 */
export function moveLeaderTo(demo: DemoScene, destination: number, budget = DEMO_MOVE_BUDGET): MoveResult {
  const field = reachableTiles(demo, budget);
  if (!field.canReach(destination)) return { moved: false, path: [] };

  const path = tracePath(field, destination);
  if (path === null || path.length < 2) return { moved: false, path: [] };

  demo.state.moveEntity(demo.leaderId, destination);
  return { moved: true, path };
}
