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
import { EncounterRunner } from '../engine/combat/encounter';
import { evaluateTarget } from '../engine/combat/targeting';
import { NO_TILE, type Spot, type TileGrid } from '../engine/grid/grid';
import { tracePath, type ReachableField } from '../engine/grid/pathfinding';
import { insideCircle } from '../engine/grid/walk';
import { reaches, type RangeBand } from '../engine/rules/range';
import type { EntityState } from '../engine/scene/state';
import { DEMO_BAND_TILES } from './demo-rules';
import type { DemoScene } from './demo-scene';
import { nameOf, note } from './log';
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
export { JUMP_ID, aimedArc, jumpAim, jumpOffered, jumpReaches, jumpTo } from './rolled-move';

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
  // In a fight a walk stays inside the circle, and one cut at its edge stops there, on the line, wherever that is.
  const options = { ...(fighting ? fightWalk(demo, id) : { inCombat: false }), short: fighting, ...(how.budget === undefined ? {} : { budget: how.budget }), ...(aim === undefined ? {} : { at: aim }) };
  const walk = demo.party.walkTo(id, goal, options);
  if ((how.short || walk?.beyond !== undefined) && walk !== null) note(demo, `${nameOf(demo, id)} can go no further without a push.`, 'combat');
  if (walk === null) return { moved: false, path: [] };
  // Whoever was down is up: getting to their feet is the first of the move.
  if (demo.world.clearCondition(id, 'prone')) note(demo, `${nameOf(demo, id)} gets up.`, fighting ? 'combat' : 'system');
  const full = walk.path;

  // A trigger stops the move where it fired: on the trigger's tile, and the
  // line is cut there too, since a straightened walk might have crossed it.
  const hit = demo.triggers.firstAlong(full, demo.state);
  const path = hit === null ? full : full.slice(0, full.indexOf(hit.tile) + 1);
  if (hit !== null) demo.state.moveEntity(id, hit.tile);
  const route = hit === null ? walk.route : demo.party.lineAlong(id, path, stood, demo.grid.spotOf(hit.tile), fighting);
  demo.motions.push({ id, path, route });

  // A step within their own tile moves nobody else: the others are where they were told to be.
  if (!fighting && path.length > 1) {
    // Each follower crosses their own line, round the same corners.
    for (const [follower, walk] of demo.party.followAlong(id, path, route)) {
      demo.motions.push({ id: follower, path: walk.path, route: walk.route });
    }
  }
  // A walk inside the circle is free, as many times as they like; only a roll spends anything.

  if (hit !== null) {
    demo.ambush = hit.encounter;
    if (!demo.animated) arrive(demo);
    return { moved: true, path, triggered: hit.encounter };
  }
  return { moved: true, path };
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
  // Nowhere in the circle to strike from: as near as it allows, for free, and no swing.
  const field = fighting ? demo.party.covered(id, fightWalk(demo, id)) : demo.party.reachable(id, { inCombat: false });
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
    note(demo, `${nameOf(demo, id)} closes in, but cannot reach ${nameOf(demo, target.id)} from inside the circle.`, 'combat');
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

/** Walk the selected member to a tile, and tell the board the line they took. */
function walkSelected(demo: Pick<DemoScene, 'state' | 'sheets' | 'party' | 'motions' | 'world' | 'log' | 'encounter'>, id: string, tile: number, fighting: boolean): void {
  const walk = demo.party.walkTo(id, tile, fighting ? fightWalk(demo, id) : { inCombat: false });
  if (walk !== null && demo.world.clearCondition(id, 'prone')) note(demo, `${nameOf(demo, id)} gets up.`, fighting ? 'combat' : 'system');
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
 * What `moveSelectedTo` would do with a click on a spot, without doing it:
 * the line drawn on the ground as the pointer moves. Null when nothing would
 * move - nobody selected, a script waiting, nowhere to go.
 */
export function previewWalk(demo: Pick<DemoScene, 'grid' | 'state' | 'party' | 'characters' | 'project' | 'ambush' | 'pending' | 'encounter'>, destination: number, aimed: Spot): WalkPreview | null {
  if (demo.pending !== null || demo.ambush !== null) return null;
  const id = demo.party.selected;
  if (id === null || !demo.party.canCommand(id)) return null;
  const fighting = inCombat(demo);
  if (fighting && !demo.encounter!.canAct(id)) return null;
  if (!demo.grid.isTile(destination)) return null;

  if (fighting) {
    // One line, to where the click aimed: as much of it as stays in the circle, and the rest of it past that.
    const walk = demo.party.planWalk(id, destination, { ...fightWalk(demo, id), short: true, at: aimed });
    if (walk === null) return null;
    const beyond = walk.beyond ?? [];
    // Asked last: the rule's own search reuses the buffers the way above was traced over.
    return { route: walk.route, beyond, run: beyond.length >= 2 && underPressure(demo, id, destination, aimed) };
  }
  const field = demo.party.reachable(id, { inCombat: false });
  if (field.canReach(destination)) {
    const walk = demo.party.planWalk(id, destination, { at: aimed });
    return walk === null ? null : { route: walk.route, beyond: [], run: false };
  }
  const nearest = nearestReachable(demo, field, aimed, NO_TILE);
  if (nearest === NO_TILE || nearest === demo.state.entity(id)!.tile) return null;
  const walk = demo.party.planWalk(id, nearest, { at: clampInto(demo.grid, aimed, nearest) });
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
 * What `moveSelectedTo` does with a click. Beyond reach is not a refusal. Out of a fight the
 * walk goes to the reachable spot nearest the one aimed at - a click across a chasm or on a
 * shut door walks up to it. In a fight it goes along the way as far as the movement does,
 * to the very spot where it runs out, and says so - unless a run would get there.
 */
export function aimOfMove(demo: Pick<DemoScene, 'grid' | 'state' | 'party' | 'encounter'>, id: string, destination: number, aimed: Spot | undefined, fighting: boolean): MoveAim {
  const nowhere: MoveAim = { goal: NO_TILE, aim: undefined, stays: true, short: false, run: false };
  if (fighting) {
    const walk = demo.party.planWalk(id, destination, { ...fightWalk(demo, id), short: true, ...(aimed === undefined ? {} : { at: aimed }) });
    // Nowhere inside the circle on the way there; a push may still open it.
    if (walk === null) return { ...nowhere, run: underPressure(demo, id, destination, aimed) };
    if (walk.beyond === undefined) return { goal: destination, aim: aimed, stays: false, short: false, run: false };
    // Past the edge: a push, where one is left; otherwise as far as the circle goes, and no further.
    if (underPressure(demo, id, destination, aimed)) return { goal: destination, aim: aimed, stays: false, short: true, run: true };
    return { goal: destination, aim: aimed, stays: false, short: true, run: false };
  }
  const field = demo.party.reachable(id, { inCombat: false });
  if (field.canReach(destination)) return { goal: destination, aim: aimed, stays: false, short: false, run: false };
  const nearest = nearestReachable(demo, field, aimed ?? demo.grid.spotOf(destination), NO_TILE);
  if (nearest === NO_TILE || nearest === demo.state.entity(id)!.tile) return nowhere;
  return { goal: nearest, aim: aimed === undefined ? undefined : clampInto(demo.grid, aimed, nearest), stays: false, short: false, run: false };
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
