/**
 * Walking: where the selected member can go, the walk itself once a destination
 * is settled, closing to strike before a swing, and the previews a view draws
 * before the click. The fight starts here too, since it starts when the
 * walkers reach the trigger, not when the board crossed it.
 *
 * What stays in `demo-scene.ts` is the click: `moveSelectedTo` decides what a
 * click means. The rolls a move can ask for - a run under pressure, a jump -
 * are scripts and live in `rolled-move.ts`. A click never jumps: that is the Jump button's. Both call in here; nothing here
 * calls back.
 */

import { attackProfile } from '../engine/character/sheet';
import { evaluateTarget } from '../engine/combat/targeting';
import { NO_TILE, type Spot, type TileGrid } from '../engine/grid/grid';
import { tracePath, type ReachableField } from '../engine/grid/pathfinding';
import { insideCircle } from '../engine/grid/walk';
import { reaches, type RangeBand } from '../engine/rules/range';
import type { EntityState } from '../engine/scene/state';
import { DEMO_BAND_TILES } from './demo-rules';
import type { DemoScene } from './demo-scene';
import { fightWalk, movementCircle, pushCircle } from './circle';
import { inCombat } from './moment';
import { standingIn } from './reach';

/** Tiles the selected member can reach right now. */
export function reachableTiles(demo: Pick<DemoScene, 'pathfinder' | 'party' | 'encounter' | 'state'>, budget?: number): ReachableField {
  const id = demo.party.selected;
  if (id === null) return demo.pathfinder.reachable(NO_TILE, 0);
  // In a fight, the ground inside the circle they move freely in; out of one, what the movement covers.
  return demo.party.covered(id, { ...(inCombat(demo) ? fightWalk(demo, id) : { inCombat: false }), ...(budget === undefined ? {} : { budget }) });
}

// The jump button's half of walking, from here so the page has one place to ask about moving.
export { JUMP_ID, aimedArc, jumpAim, jumpOffered, jumpReaches } from './rolled-move';

export interface MoveResult {
  moved: boolean;
  path: number[];
  /** The encounter this move woke, if any. */
  triggered?: string;
  /** An Agility Roll stands between the click and the walk: it is asked, and the walk waits on it. */
  pending?: true;
}

/**
 * Whether a click past the circle is one a push could reach: there is a next distance step to open,
 * and a way there at all. The push opens one step; a click past even that walks as far as the wider
 * circle allows, and says so.
 */
export function underPressure(demo: Pick<DemoScene, 'grid' | 'state' | 'party' | 'encounter'>, id: string, destination: number, aimed?: Spot): boolean {
  const circle = movementCircle(demo, id);
  // Only a spot outside the circle is a push: inside it, a walk that cannot be made cannot be made.
  if (circle === null || pushCircle(demo, id) === null || insideCircle(aimed ?? demo.grid.spotOf(destination), circle)) return false;
  return demo.party.reachable(id, { inCombat: true, budget: Infinity }).canReach(destination);
}

/**
 * Where a click would ask the selected fighter for an Agility Roll: the ground inside the circle a
 * push would open and outside their own. Empty out of a fight, or with nobody who can act selected.
 */
export function underPressureTiles(demo: Pick<DemoScene, 'grid' | 'state' | 'party' | 'encounter'>): number[] {
  const id = demo.party.selected;
  const push = id === null ? null : pushCircle(demo, id);
  if (id === null || push === null || !demo.encounter!.canAct(id)) return [];
  const inside = new Set(demo.party.covered(id, fightWalk(demo, id)).tiles());
  return demo.party.covered(id, { inCombat: true, budget: Infinity, within: push }).tiles().filter((tile) => !inside.has(tile));
}

/**
 * The tile the selected member would strike a target from: their own when it
 * is already in reach, else the cheapest to walk to this move that the weapon
 * reaches from; `NO_TILE` when none is.
 */
function strikeTile(demo: Pick<DemoScene, 'grid' | 'state' | 'party' | 'encounter'>, id: string, target: EntityState, range: RangeBand): number {
  const attacker = demo.state.entity(id)!;
  // From where they would stand to where the target does: the measure the swing itself will take.
  const inReach = (tile: number): boolean =>
    evaluateTarget(demo.grid, tile, target.tile, range, { bandTiles: DEMO_BAND_TILES, at: { attacker: standingIn(demo, id, tile), target: target.at } }).refusal === null;
  if (inReach(attacker.tile)) return attacker.tile;
  const field = inCombat(demo) ? demo.party.covered(id, fightWalk(demo, id)) : demo.party.reachable(id, { inCombat: false });
  let best = NO_TILE;
  let bestCost = Infinity;
  for (const tile of field.tiles()) {
    if (tile === attacker.tile || !inReach(tile)) continue;
    const cost = field.costTo(tile);
    if (cost < bestCost || (cost === bestCost && tile < best)) {
      best = tile;
      bestCost = cost;
    }
  }
  return best;
}

/**
 * The line a click on an adversary would walk before the swing: none when
 * already in reach or nothing would move.
 */
export function previewStrike(demo: Pick<DemoScene, 'grid' | 'state' | 'party' | 'characters' | 'ambush' | 'pending' | 'encounter'>, targetId: string): Spot[] | null {
  if (demo.pending !== null || demo.ambush !== null) return null;
  const id = demo.party.selected;
  const character = id === null ? undefined : demo.characters.get(id);
  const target = demo.state.entity(targetId);
  if (id === null || character === undefined || target === undefined || !target.alive) return null;
  const fighting = inCombat(demo);
  if (fighting && !demo.encounter!.canAct(id)) return null;
  const attacker = demo.state.entity(id)!;
  const from = strikeTile(demo, id, target, attackProfile(character).range);
  if (from === NO_TILE || from === attacker.tile) return null;
  return demo.party.planWalk(id, from, fighting ? fightWalk(demo, id) : { inCombat: false })?.route ?? null;
}

/** The line a click would walk: what is walked this move, and what lies beyond it. */
export interface WalkPreview {
  route: Spot[];
  /** In a fight, the rest of the way to where the click aimed, past what one move allows. */
  beyond: Spot[];
  /** Whether `beyond` is a run an Agility Roll would get there on, rather than a way no move covers. */
  run: boolean;
}

/**
 * `from`, when given, is the ground the figure is actually standing on: part-way through a walk
 * that is not where the document says they are, and the line has to be drawn from the body a
 * player is looking at, because a click there will interrupt the walk and start from exactly
 * there. See `game/land.ts`.
 *
 * What `moveSelectedTo` would do with a click on a spot, without doing it:
 * the line drawn on the ground as the pointer moves. Null when nothing would
 * move - nobody selected, a script waiting, nowhere to go.
 */
export function previewWalk(demo: Pick<DemoScene, 'grid' | 'state' | 'party' | 'characters' | 'project' | 'ambush' | 'pending' | 'encounter'>, destination: number, aimed: Spot, from?: Spot): WalkPreview | null {
  if (demo.pending !== null || demo.ambush !== null) return null;
  const id = demo.party.selected;
  if (id === null || !demo.party.canCommand(id)) return null;
  const fighting = inCombat(demo);
  if (fighting && !demo.encounter!.canAct(id)) return null;
  if (!demo.grid.isTile(destination)) return null;

  if (fighting) {
    // One line, to where the click aimed: as much of it as stays in the circle, and the rest of it past that.
    const walk = demo.party.planWalk(id, destination, { ...fightWalk(demo, id), short: true, at: aimed, ...(from === undefined ? {} : { from }) });
    if (walk === null) return null;
    const beyond = walk.beyond ?? [];
    // Asked last: the rule's own search reuses the buffers the way above was traced over.
    return { route: walk.route, beyond, run: beyond.length >= 2 && underPressure(demo, id, destination, aimed) };
  }
  const field = demo.party.reachable(id, { inCombat: false, ...(from === undefined ? {} : { from }) });
  if (field.canReach(destination)) {
    const walk = demo.party.planWalk(id, destination, { at: aimed, ...(from === undefined ? {} : { from }) });
    return walk === null ? null : { route: walk.route, beyond: [], run: false };
  }
  const nearest = nearestReachable(demo, field, aimed, NO_TILE);
  if (nearest === NO_TILE || nearest === demo.state.entity(id)!.tile) return null;
  const walk = demo.party.planWalk(id, nearest, { at: clampInto(demo.grid, aimed, nearest), ...(from === undefined ? {} : { from }) });
  return walk === null ? null : { route: walk.route, beyond: [], run: false };
}

/** Where a click takes the selected one: the tile and the spot in it, whether the move stops short, and whether it is a run. */
export interface MoveAim {
  goal: number;
  aim: Spot | undefined;
  /** Nowhere to go from here: the click does nothing. */
  stays: boolean;
  short: boolean;
  /** Past one move and within a run: Movement Under Pressure, with `goal` and `aim` what a failure still walks. */
  run: boolean;
}

/**
 * The reachable tile a walk beyond reach ends on. Given a tile the way to
 * which is only too long (`along`), the furthest tile along that way still in
 * reach; otherwise the reachable tile nearest the spot aimed at, as the crow
 * flies. `NO_TILE` when nothing at all is in reach.
 */
export function nearestReachable(demo: Pick<DemoScene, 'grid' | 'party'>, field: ReachableField, aimed: Spot, along: number): number {
  const id = demo.party.selected!;
  if (along !== NO_TILE) {
    // The bounded field is a view over shared buffers: keep it before asking
    // for the way there without a budget.
    const inReach = field.clone();
    const whole = demo.party.reachable(id, { inCombat: true, budget: Infinity });
    const path = tracePath(whole, along);
    if (path !== null) {
      for (let i = path.length - 1; i >= 0; i--) if (inReach.canReach(path[i]!)) return path[i]!;
    }
    return NO_TILE;
  }
  let best = NO_TILE;
  let bestDistance = Infinity;
  for (const tile of field.tiles()) {
    const distance = Math.hypot(demo.grid.xOf(tile) - aimed.x, demo.grid.yOf(tile) - aimed.y);
    if (distance < bestDistance || (distance === bestDistance && tile < best)) {
      best = tile;
      bestDistance = distance;
    }
  }
  return best;
}

/** The spot within a tile nearest to one aimed at outside it. */
export function clampInto(grid: TileGrid, aimed: Spot, tile: number): Spot {
  const x = grid.xOf(tile);
  const y = grid.yOf(tile);
  return { x: Math.min(x + 0.49, Math.max(x - 0.49, aimed.x)), y: Math.min(y + 0.49, Math.max(y - 0.49, aimed.y)) };
}
