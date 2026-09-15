/**
 * Walking: where the selected member can go, the walk itself once a destination
 * is settled, closing to strike before a swing, and the previews a view draws
 * before the click. The fight starts here too, since it starts when the
 * walkers reach the trigger, not when the board crossed it.
 *
 * What stays in `demo-scene.ts` is the click and the roll: `moveSelectedTo`
 * decides what a click means, and `runForIt` rolls Movement Under Pressure,
 * which is a script and so belongs to the fight. Both call in here; nothing
 * here calls back.
 */

import { attackProfile } from '../engine/character/sheet';
import { moveUnderPressure } from '../engine/combat/area';
import { EncounterRunner } from '../engine/combat/encounter';
import { evaluateTarget } from '../engine/combat/targeting';
import { NO_TILE, type Spot, type TileGrid } from '../engine/grid/grid';
import { tracePath, type ReachableField } from '../engine/grid/pathfinding';
import { smoothPath } from '../engine/grid/walk';
import { maxTilesForBand, reaches, type RangeBand } from '../engine/rules/range';
import type { EntityState } from '../engine/scene/state';
import { DEMO_BAND_TILES, DEMO_WALK } from './demo-rules';
import type { DemoScene } from './demo-scene';
import { nameOf, note } from './log';
import { inCombat } from './moment';

/** Tiles the selected member can reach right now. */
export function reachableTiles(demo: Pick<DemoScene, 'pathfinder' | 'party' | 'encounter'>, budget?: number): ReachableField {
  const id = demo.party.selected;
  if (id === null) return demo.pathfinder.reachable(NO_TILE, 0);
  return demo.party.reachable(id, { inCombat: inCombat(demo), budget });
}

export interface MoveResult {
  moved: boolean;
  path: number[];
  /** The encounter this move woke, if any. */
  triggered?: string;
  /** An Agility Roll stands between the click and the walk: it is asked, and the walk waits on it. */
  pending?: true;
}

/**
 * The walk a move makes once where it goes is settled: the line crossed, a trigger stopping it where
 * it fires, the followers out of a fight, and the action spent in one - unless `act` is false,
 * because a roll that asked for the walk was the action and spends it itself.
 */
export function walkTheMove(
  demo: Pick<DemoScene, 'grid' | 'state' | 'party' | 'sheets' | 'triggers' | 'world' | 'log' | 'motions' | 'animated' | 'ambush' | 'encounter'>,
  id: string,
  goal: number,
  aim: Spot | undefined,
  how: { fighting: boolean; short: boolean; budget?: number; act?: boolean },
): MoveResult {
  const fighting = how.fighting;
  const stood = { ...demo.state.entity(id)!.at };
  const options = { inCombat: fighting, ...(how.budget === undefined ? {} : { budget: how.budget }), ...(aim === undefined ? {} : { at: aim }) };
  const walk = demo.party.walkTo(id, goal, options);
  if (how.short && walk !== null) note(demo, `${nameOf(demo, id)} can go no further this turn.`, 'combat');
  if (walk === null) return { moved: false, path: [] };
  const full = walk.path;

  // A trigger stops the move where it fired: on the trigger's tile, and the
  // line is cut there too, since a straightened walk might have crossed it.
  const hit = demo.triggers.firstAlong(full, demo.state);
  const path = hit === null ? full : full.slice(0, full.indexOf(hit.tile) + 1);
  if (hit !== null) demo.state.moveEntity(id, hit.tile);
  const route = hit === null ? walk.route : demo.party.lineAlong(id, path, stood, demo.grid.spotOf(hit.tile), fighting);
  demo.motions.push({ id, path, route });

  if (!fighting) {
    // Each follower crosses their own line, round the same corners.
    for (const [follower, walk] of demo.party.followAlong(id, path, route)) {
      demo.motions.push({ id: follower, path: walk.path, route: walk.route });
    }
  }
  if (fighting && how.act !== false) demo.encounter!.act(id);

  if (hit !== null) {
    demo.ambush = hit.encounter;
    if (!demo.animated) arrive(demo);
    return { moved: true, path, triggered: hit.encounter };
  }
  return { moved: true, path };
}

/** How far a run under pressure may go: Very Far, spent along the way as a fighter's move is. */
export const RUN_TILES = maxTilesForBand('veryFar', DEMO_BAND_TILES);

/**
 * Whether a click past one move is one an Agility Roll could get a fighter to: past Close, as far as
 * Very Far, and with a way there that a run covers. A walk here is the action, so a walk within Close
 * is made as part of it and needs no roll - the rule's own `withAction`.
 */
export function underPressure(demo: Pick<DemoScene, 'grid' | 'state' | 'party'>, id: string, destination: number): boolean {
  return asksForRoll(demo, id, destination) && demo.party.reachable(id, { inCombat: true, budget: RUN_TILES }).canReach(destination);
}

/** Whether the rule asks a fighter for an Agility Roll to walk from where they stand to here, as the crow flies. */
function asksForRoll(demo: Pick<DemoScene, 'grid' | 'state'>, id: string, destination: number): boolean {
  const from = demo.state.entity(id)!.tile;
  return moveUnderPressure(demo.grid, 'pc', from, destination, { bandTiles: DEMO_BAND_TILES, withAction: true }) === 'agilityRoll';
}

/**
 * Where a click would ask the selected fighter for an Agility Roll: past one move, and a run away.
 * Empty out of a fight, or with nobody who can act selected.
 */
export function underPressureTiles(demo: Pick<DemoScene, 'grid' | 'state' | 'party' | 'encounter'>): number[] {
  const id = demo.party.selected;
  if (id === null || !inCombat(demo) || !demo.encounter!.canAct(id)) return [];
  const inReach = new Set(demo.party.reachable(id, { inCombat: true }).tiles());
  const run = demo.party.reachable(id, { inCombat: true, budget: RUN_TILES }).tiles();
  // Every tile of the run is a way there already, so only the rule is asked of each.
  return run.filter((tile) => !inReach.has(tile) && asksForRoll(demo, id, tile));
}

/**
 * The walkers are where the board put them. Whatever the walk woke begins now.
 * Whoever draws the tokens calls this when the last of them stops; headless,
 * the move itself does.
 */
export function arrive(demo: Pick<DemoScene, 'state' | 'ambush' | 'encounter'>): boolean {
  if (demo.ambush === null) return false;
  const encounter = demo.ambush;
  demo.ambush = null;
  startEncounter(demo, encounter);
  return true;
}

/**
 * Bring the selected member into reach of a target before a swing: nothing
 * when already in reach, the walk to the nearest spot the weapon reaches from
 * when one is within this move, and otherwise as far along the way as the
 * move allows - `short`, the action spent on the walk.
 */
export function closeToStrike(demo: Pick<DemoScene, 'grid' | 'state' | 'party' | 'sheets' | 'world' | 'log' | 'motions' | 'encounter'>, id: string, target: EntityState, range: RangeBand): 'inReach' | 'closed' | 'short' {
  const attacker = demo.state.entity(id)!;
  const fighting = inCombat(demo);
  const strikeFrom = strikeTile(demo, id, target, range);
  if (strikeFrom === attacker.tile) return 'inReach';
  if (strikeFrom !== NO_TILE) {
    walkSelected(demo, id, strikeFrom, fighting);
    return 'closed';
  }
  const field = demo.party.reachable(id, { inCombat: fighting });
  let best = attacker.tile;
  let bestDistance = demo.grid.euclideanDistance(attacker.tile, target.tile);
  for (const tile of field.tiles()) {
    const distance = demo.grid.euclideanDistance(tile, target.tile);
    if (distance < bestDistance || (distance === bestDistance && tile < best)) {
      best = tile;
      bestDistance = distance;
    }
  }
  if (best !== attacker.tile) {
    walkSelected(demo, id, best, fighting);
    note(demo, `${nameOf(demo, id)} closes in, but cannot reach ${nameOf(demo, target.id)} this turn.`, 'combat');
    if (fighting) demo.encounter!.act(id);
  }
  return 'short';
}

/**
 * The tile the selected member would strike a target from: their own when it
 * is already in reach, else the cheapest to walk to this move that the weapon
 * reaches from; `NO_TILE` when none is.
 */
function strikeTile(demo: Pick<DemoScene, 'grid' | 'state' | 'party' | 'encounter'>, id: string, target: EntityState, range: RangeBand): number {
  const attacker = demo.state.entity(id)!;
  const inReach = (tile: number): boolean =>
    evaluateTarget(demo.grid, tile, target.tile, range, { bandTiles: DEMO_BAND_TILES }).refusal === null;
  if (inReach(attacker.tile)) return attacker.tile;
  const field = demo.party.reachable(id, { inCombat: inCombat(demo) });
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

/** Walk the selected member to a tile, and tell the board the line they took. */
function walkSelected(demo: Pick<DemoScene, 'party' | 'motions'>, id: string, tile: number, fighting: boolean): void {
  const walk = demo.party.walkTo(id, tile, { inCombat: fighting });
  if (walk !== null) demo.motions.push({ id, path: walk.path, route: walk.route });
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
  return demo.party.planWalk(id, from, { inCombat: fighting })?.route ?? null;
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
 * What `moveSelectedTo` would do with a click on a spot, without doing it:
 * the line drawn on the ground as the pointer moves. Null when nothing would
 * move - nobody selected, a script waiting, nowhere to go.
 */
export function previewWalk(demo: Pick<DemoScene, 'grid' | 'state' | 'party' | 'ambush' | 'pending' | 'encounter'>, destination: number, aimed: Spot): WalkPreview | null {
  if (demo.pending !== null || demo.ambush !== null) return null;
  const id = demo.party.selected;
  if (id === null || !demo.party.canCommand(id)) return null;
  const fighting = inCombat(demo);
  if (fighting && !demo.encounter!.canAct(id)) return null;
  if (!demo.grid.isTile(destination)) return null;

  const field = demo.party.reachable(id, { inCombat: fighting });
  if (field.canReach(destination)) {
    const walk = demo.party.planWalk(id, destination, { inCombat: fighting, at: aimed });
    return walk === null ? null : { route: walk.route, beyond: [], run: false };
  }
  const nearest = nearestReachable(demo, field, aimed, fighting ? destination : NO_TILE);
  if (nearest === NO_TILE || nearest === demo.state.entity(id)!.tile) return null;
  const walk = demo.party.planWalk(id, nearest, { inCombat: fighting, at: clampInto(demo.grid, aimed, nearest) });
  if (walk === null) return null;
  if (!fighting) return { route: walk.route, beyond: [], run: false };
  // The rest of the way, from where this move stops to where the click aimed.
  const whole = demo.party.reachable(id, { inCombat: true, budget: Infinity });
  const path = tracePath(whole, destination);
  const rest = path === null ? null : path.slice(path.indexOf(nearest));
  const beyond =
    rest === null || rest.length < 2
      ? []
      : smoothPath(demo.grid, rest, demo.state.blockedFor(id), DEMO_WALK, { start: walk.route[walk.route.length - 1]!, end: aimed });
  // Asked last: the rule's own search reuses the buffers the way above was traced over.
  return { route: walk.route, beyond, run: beyond.length >= 2 && underPressure(demo, id, destination) };
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

/** Begin a fight. Safe to call twice. */
export function startEncounter(demo: Pick<DemoScene, 'state' | 'encounter'>, encounterId: string): EncounterRunner {
  if (demo.encounter !== null && demo.encounter.encounterId === encounterId) return demo.encounter;
  const runner = new EncounterRunner(demo.state, encounterId);
  runner.start();
  demo.encounter = runner;
  return runner;
}
