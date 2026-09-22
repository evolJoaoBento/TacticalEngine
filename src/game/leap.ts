/**
 * Jumping: a thing asked for by name, and aimed.
 *
 * Nobody jumps by walking. A click on the ground is a walk and only ever a walk, however high
 * what was clicked stands; the Jump button is how a jump is asked for. Armed, it aims from
 * where the jumper stands, along an arc, to anywhere in range - across level ground, over a
 * low wall or somebody's head, up onto a block or down off one. Only when what is aimed at
 * is past that range does any walking come into it: they walk to the nearest spot the jump
 * can be made from, and make it from there.
 *
 * What a step is, which trait carries what and what it all costs are the project's to say
 * (`engine/rules/jump.ts`); this file reads them and never a number of its own. It is the
 * arithmetic and the search, and rolls nothing: `rolled-move.ts` asks for the roll and lands
 * them, and the view draws the arc.
 */

import { NO_TILE, type Spot } from '../engine/grid/grid';
import { VOID_TERRAIN_ID } from '../engine/grid/terrain';
import { canStandAt, lineLength, pointAlong, settleEnd, splitLine } from '../engine/grid/walk';
import { arcHeight, arcLift, jumpRange, leapTerms, type LeapTerms } from '../engine/rules/jump';
import type { DemoScene } from './demo-scene';
import { jumpRulesFor, walkFor } from './demo-rules';
import { fightWalk, movementCircle } from './circle';
import { inCombat } from './moment';

/** A jump worked out: where it is made from, where it lands, and what it asks. */
export interface Leap extends LeapTerms {
  /** The tile it is made from: the jumper's own, or one a walk reaches this move when the landing is past their range. */
  from: number;
  to: number;
  /** Where exactly it is made from and where it lands, in tile units: a jump is aimed at a spot, as a walk is. */
  fromAt: Spot;
  at: Spot;
  /** The line walked to `fromAt` first, when the landing was past their range from where they stood; else absent. */
  walk?: Spot[];
  /** How far it is across the ground, in tiles, between those two. */
  across: number;
  /** Blocks from where they stand to where they land: up is positive, down negative. */
  rise: number;
  /** How high it arcs over the straight line between its ends, in blocks: what is drawn, checked and flown. */
  lift: number;
}

type Jumper = Pick<DemoScene, 'grid' | 'state' | 'party' | 'characters' | 'project' | 'encounter'>;

/** How finely an arc is checked against what stands under it, in tiles. */
const ARC_STRIDE = 0.2;

/**
 * Whether a jump's arc gets from one tile to another without meeting anything.
 *
 * The arc is the one the aim draws. Along the line under it, ground that stands higher than the
 * arc passes is in the way, and so is anything nobody could stand on however high the arc -
 * a kind of tile that says it is impassable, a barred cell, a shut door. Bodies are not: a
 * jump goes over people. The two ends are never in their own way.
 */
function arcClear(demo: Jumper, a: Spot, b: Spot, lift: number): boolean {
  const grid = demo.grid;
  const from = grid.tileAtSpot(a.x, a.y);
  const to = grid.tileAtSpot(b.x, b.y);
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / ARC_STRIDE));
  // Every faction passes: what is left of "blocked" is the things, which is what stops an arc.
  const shut = demo.state.blockedFor('', ['party', 'adversary', 'neutral']);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const under = grid.tileAtSpot(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    if (under === from || under === to) continue;
    // Nothing under the arc is a gap, and a gap is what a jump is for; anything else nobody can stand in is in the way.
    if (under === NO_TILE || shut(under) || (!grid.isPassable(under) && grid.topAt(under).id !== VOID_TERRAIN_ID)) return false;
    if (grid.standAt(under) > arcHeight(grid.standAt(from), grid.standAt(to), lift, t) + 1e-6) return false;
  }
  return true;
}

/**
 * The jump from one tile to another, for this jumper: null when it cannot be made - out of
 * range, too high, nowhere to land, or something in the way of the arc.
 */
function planJumpFrom(demo: Jumper, id: string, fromAt: Spot, to: number, aim?: Spot): Leap | null {
  const character = demo.characters.get(id);
  const rules = jumpRulesFor(demo.project);
  if (character === undefined || !rules.enabled) return null;
  const from = demo.grid.tileAtSpot(fromAt.x, fromAt.y);
  if (!demo.grid.isTile(to) || to === from || !demo.state.bodyFree(to, id)) return null;
  // Measured between the spots, not the squares: from where they would be standing to where
  // they were aimed, or as near it as a body lands clear.
  const at = aim === undefined ? demo.grid.spotOf(to) : landing(demo, id, to, aim);
  const across = Math.hypot(at.x - fromAt.x, at.y - fromAt.y);
  if (across > jumpRange(rules, character.traits) + 1e-6) return null;
  const rise = demo.grid.standAt(to) - demo.grid.standAt(from);
  const terms = leapTerms(rules, rise, character.traits);
  const lift = arcLift(across, rise);
  if (terms === null || !arcClear(demo, fromAt, at, lift)) return null;
  return { ...terms, from, to, fromAt, at, across, rise, lift };
}

/** Where a jump aimed at a spot comes down: the spot, when a body fits there clear of everybody; else back towards the tile's centre. */
function landing(demo: Jumper, id: string, to: number, aim: Spot): Spot {
  const others = demo.state
    .allEntities()
    .filter((e) => e.id !== id && e.alive && e.tile !== NO_TILE)
    .map((e) => e.at);
  return settleEnd(demo.grid, to, aim, demo.state.blockedFor(id), others, walkFor(demo.project));
}

/** The jump from where they stand, as it is aimed - at a tile's centre, or at a spot in it; null when it cannot be made from there. */
export function planJump(demo: Jumper, id: string, to: number, aim?: Spot): Leap | null {
  const stood = demo.state.entity(id);
  return stood === undefined ? null : planJumpFrom(demo, id, { ...stood.at }, to, aim);
}

/** How finely a run-up is searched for the point the jump comes into range, in tiles. */
const RUN_UP_STRIDE = 0.1;

/**
 * The jump at the end of a walk to a tile - made from the first point *along* the walk it can
 * be made from, not from the tile's centre: a run-up ends where the jump comes into range and
 * there is room to stand, to a tenth of a tile. Null when the walk cannot be made this move
 * (in a fight it is cut where the movement runs out) or nowhere on it is close enough.
 */
function planJumpAfterWalk(demo: Jumper, id: string, via: number, to: number, aim: Spot | undefined, fighting: boolean): Leap | null {
  // In a fight the run-up stays inside the circle, cut at its edge; out of one it goes where the floor does.
  const walk = demo.party.planWalk(id, via, { ...(fighting ? fightWalk(demo, id) : { inCombat: false }), short: fighting });
  if (walk === null) return null;
  const route = walk.route;
  const blocked = demo.state.blockedFor(id);
  const rules = walkFor(demo.project);
  const others = demo.state
    .allEntities()
    .filter((e) => e.id !== id && e.alive && e.tile !== NO_TILE)
    .map((e) => e.at);
  const length = lineLength(route);
  for (let gone = RUN_UP_STRIDE; gone < length + RUN_UP_STRIDE; gone += RUN_UP_STRIDE) {
    const here = gone >= length ? { ...route[route.length - 1]! } : pointAlong(route, gone);
    if (!canStandAt(demo.grid, here, blocked, rules) || others.some((o) => Math.hypot(o.x - here.x, o.y - here.y) < 2 * rules.radius)) continue;
    const leap = planJumpFrom(demo, id, here, to, aim);
    if (leap === null) continue;
    return { ...leap, walk: gone >= length ? route.map((spot) => ({ ...spot })) : splitLine(route, gone).within };
  }
  return null;
}

/**
 * The jump to a tile, with a walk in front of it only if it needs one.
 *
 * From where they stand when that reaches - that is the jump, and nothing is walked. Past
 * their range, the cheapest spot this move walks to from which the jump can be made: out of a
 * fight anywhere the floor goes, in one as far as the move allows. Null when neither does.
 */
export function planRunningJump(demo: Jumper, id: string, to: number, aim?: Spot): Leap | null {
  const direct = planJump(demo, id, to, aim);
  const character = demo.characters.get(id);
  if (direct !== null || character === undefined || !demo.grid.isTile(to)) return direct;
  const fighting = inCombat(demo);
  // The tiles a jump could be made from, the one nearest the landing first: the run-up is the
  // walk *towards* where they are going, and it stops the moment the jump comes into range along
  // it - so it heads for the landing, not for whichever launch square is cheapest to reach, which
  // would bend the line to the grid. Kept: the pathfinder's buffers are anybody's after this.
  // In a fight the run-up is cut at the circle's edge, so a square a whole tile outside it is not tried.
  const field = demo.party.reachable(id, { inCombat: fighting, budget: Infinity }).clone();
  const circle = fighting ? movementCircle(demo, id) : null;
  const near = (tile: number): boolean => circle === null || Math.hypot(demo.grid.xOf(tile) - circle.anchor.x, demo.grid.yOf(tile) - circle.anchor.y) <= circle.radius + 1;
  const reach = Math.ceil(jumpRange(jumpRulesFor(demo.project), character.traits));
  const land = aim === undefined ? demo.grid.spotOf(to) : landing(demo, id, to, aim);
  const x0 = demo.grid.xOf(to);
  const y0 = demo.grid.yOf(to);
  const launches: number[] = [];
  for (let y = y0 - reach; y <= y0 + reach; y++) {
    for (let x = x0 - reach; x <= x0 + reach; x++) {
      const from = demo.grid.indexOf(x, y);
      if (from !== NO_TILE && field.canReach(from) && near(from) && planJumpFrom(demo, id, demo.grid.spotOf(from), to, aim) !== null) launches.push(from);
    }
  }
  const away = (tile: number): number => Math.hypot(demo.grid.xOf(tile) - land.x, demo.grid.yOf(tile) - land.y);
  launches.sort((a, b) => away(a) - away(b) || field.costTo(a) - field.costTo(b) || a - b);
  // The run-up towards the nearest of them, ending where the jump first comes into range along it.
  for (const via of launches) {
    const leap = planJumpAfterWalk(demo, id, via, to, aim, fighting);
    if (leap !== null) return leap;
  }
  return null;
}

/**
 * Everywhere the selected member could jump to from where they stand: what the Jump button
 * lights. Their range as it is, so the disc on the board is the jump and not the walk; a
 * spot past it can still be aimed at, and is walked towards first.
 */
export function leapTargets(demo: Jumper, id: string): number[] {
  const character = demo.characters.get(id);
  const stood = demo.state.entity(id);
  if (character === undefined || stood === undefined) return [];
  const reach = Math.ceil(jumpRange(jumpRulesFor(demo.project), character.traits));
  const x0 = demo.grid.xOf(stood.tile);
  const y0 = demo.grid.yOf(stood.tile);
  const landings: number[] = [];
  for (let y = y0 - reach; y <= y0 + reach; y++) {
    for (let x = x0 - reach; x <= x0 + reach; x++) {
      const to = demo.grid.indexOf(x, y);
      if (to !== NO_TILE && planJump(demo, id, to) !== null) landings.push(to);
    }
  }
  return landings;
}

/** What the aim draws towards a tile: a walk when one is needed, the arc, and whether it can be made. */
export interface JumpArc {
  /** The line walked before the jump, when the landing is past their range; else empty. */
  walk: readonly Spot[];
  from: Spot;
  to: Spot;
  lift: number;
  ok: boolean;
}

/** What to draw while a jump is aimed at a tile: gold along the way it would go, red from where they stand when it cannot. */
export function jumpArc(demo: Jumper, id: string, to: number, aim?: Spot): JumpArc | null {
  const stood = demo.state.entity(id);
  if (stood === undefined || !demo.grid.isTile(to) || to === stood.tile) return null;
  const leap = planRunningJump(demo, id, to, aim);
  if (leap === null) {
    const rise = demo.grid.standAt(to) - demo.grid.standAt(stood.tile);
    const end = aim ?? demo.grid.spotOf(to);
    return { walk: [], from: stood.at, to: end, lift: arcLift(Math.hypot(end.x - stood.at.x, end.y - stood.at.y), rise), ok: false };
  }
  return { walk: leap.walk ?? [], from: leap.fromAt, to: leap.at, lift: leap.lift, ok: true };
}
