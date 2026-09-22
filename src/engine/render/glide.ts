/**
 * A token on its way somewhere.
 *
 * The engine's truth never waits on this — the state already has the creature
 * where it is going — so a glide is only the drawing of the journey: the line it
 * crosses, how long that takes, and how high it lifts on the way. A walk keeps
 * its feet on the ground, takes a fixed time per tile of line however many
 * corners the line has, and faces where it is going; a throw is one quick arc
 * that slows into its landing.
 *
 * Arithmetic over a grid and a layout, with no scene in it: what a walk looks
 * like can be read in a test. `SceneView` keeps the glides, plays the clips, and
 * decides when one is finished with.
 */

import type { Spot, TileGrid } from '../grid/grid';
import { lineLength } from '../grid/walk';
import { spotToWorld, type TileLayout } from './layout';
import type { BuiltModel } from './procedural/build';

export interface Glide {
  token: BuiltModel;
  /** Where it goes through, first point where it is now. */
  points: { x: number; y: number; z: number }[];
  /** Distance along the line at each point, and the whole of it. */
  cumulative: number[];
  total: number;
  elapsed: number;
  duration: number;
  /** How high it lifts: a step's worth on a walk, once over the whole of a throw. */
  hop: number;
  /** Steps per world unit walked, so the bob keeps time with the ground covered rather than the clock. */
  bobs: number;
  thrown: boolean;
  /** The leg that is a jump rather than a walk - always the last - or -1. */
  leapLeg: number;
  /** How high that jump arcs over the straight line between its ends. */
  leapArc: number;
}

/**
 * Seconds per tile of line for a walk, and what a throw takes whatever it crosses.
 *
 * A walking pace: about two and a half tiles a second, so a room takes long enough to watch and
 * crossing the woods is a journey. Steering reads this too, so a held walk goes at a walk.
 */
export const WALK_PER_TILE = 0.4;
const THROW_SECONDS = 0.25;
const THROW_HOP = 0.35;
/** How high a walking token rises on each step, in world units, and how many steps it takes to a tile. */
export const WALK_HOP = 0.055;
const WALK_STEPS_PER_TILE = 2;
/** What a jump takes, whatever it crosses: long enough to see it gather and land. */
export const LEAP_SECONDS = 0.62;
/** The parts of a jump, as fractions of it: gathering on the spot, in the air, and taking the landing. */
const LEAP_GATHER = 0.24;
const LEAP_LAND = 0.84;

/**
 * Work out the journey: along the line it was handed when there is one, else the
 * path's centres from where it stood to where it stands, else straight there.
 *
 * Every leg is cut at most half a tile long, so the height follows the ground
 * under the line rather than jumping at each corner, and the first point is
 * wherever the token is right now — a second move mid-glide carries on from
 * there rather than snapping back.
 */
export function planGlide(
  grid: TileGrid,
  layout: TileLayout,
  token: BuiltModel,
  from: Spot,
  to: Spot,
  path: readonly number[] | undefined,
  route: readonly Spot[] | undefined,
  thrown: boolean,
  /** The last leg is a jump, arcing this many blocks over the straight line between its ends. */
  leap?: number,
): Glide {
  const lift = token.spec.groundOffset ?? 0;
  const fromTile = grid.tileAtSpot(from.x, from.y);
  const toTile = grid.tileAtSpot(to.x, to.y);
  let spots: Spot[];
  if (route !== undefined && route.length >= 2) spots = [...route];
  else if (path !== undefined && path.length >= 2 && path[0] === fromTile && path[path.length - 1] === toTile) {
    spots = path.map((tile) => grid.spotOf(tile));
    spots[0] = from;
    spots[spots.length - 1] = to;
  } else spots = [from, to];

  const points: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i + 1 < spots.length; i++) {
    const a = spots[i]!;
    const b = spots[i + 1]!;
    // A jump is one leg, end to end: cut in half-tiles it would follow the ground up the face of the block.
    const pieces = leap !== undefined && i === spots.length - 2 ? 1 : Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.5));
    for (let k = i === 0 ? 0 : 1; k <= pieces; k++) {
      const t = k / pieces;
      const w = spotToWorld(grid, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, layout);
      points.push({ x: w.x, y: w.y + lift, z: w.z });
    }
  }
  if (points.length < 2) {
    const w = spotToWorld(grid, to, layout);
    points.push({ x: w.x, y: w.y + lift, z: w.z });
  }
  // Continue from wherever the token is, so a second move mid-glide does not jump back.
  const start = token.group.position;
  points[0] = { x: start.x, y: start.y, z: start.z };

  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    cumulative.push(cumulative[i - 1]! + Math.hypot(b.x - a.x, b.z - a.z));
  }
  // The jump's leg is counted not by how far it goes but by how long it takes: the share of
  // the line that gives it `LEAP_SECONDS` of a journey otherwise walked at a walk's pace.
  const leapLeg = leap !== undefined && !thrown && points.length >= 2 ? points.length - 2 : -1;
  let leapArc = 0;
  let walked = lineLength(spots);
  if (leapLeg >= 0) {
    const across = cumulative[leapLeg + 1]! - cumulative[leapLeg]!;
    walked = Math.max(0, walked - across / layout.tileSize);
    const before = cumulative[leapLeg]!;
    cumulative[leapLeg + 1] = before + (before <= 1e-9 ? 1 : (before * LEAP_SECONDS) / (WALK_PER_TILE * Math.max(walked, 1e-6)));
    // The arc the aim drew and the rule checked, in world units: a block is a tile high.
    leapArc = layout.tileSize * leap!;
  }
  const total = cumulative[cumulative.length - 1]!;
  // A fixed pace per tile actually crossed - the line from where the token is now, not the line the
  // walk was planned along. A second click mid-walk leaves the token behind its own character, and
  // timing the new journey by the plan rather than by the ground would make it slide to catch up.
  const crossed = leapLeg >= 0 ? walked : total / layout.tileSize;
  return {
    token,
    points,
    cumulative,
    total,
    elapsed: 0,
    duration: thrown ? THROW_SECONDS : Math.max(1e-3, WALK_PER_TILE * crossed) + (leapLeg >= 0 ? LEAP_SECONDS : 0),
    hop: thrown ? THROW_HOP : WALK_HOP,
    bobs: thrown ? 0 : WALK_STEPS_PER_TILE / layout.tileSize,
    thrown,
    leapLeg,
    leapArc,
  };
}

/**
 * Move one glide on by `dt` seconds, and say whether it has arrived.
 *
 * Steady along the line wherever its corners fall: a throw slows into its
 * landing and arcs over the whole of it, a walk keeps its pace, stays on the
 * ground, and turns to face the leg it is on.
 */
export function advanceGlide(glide: Glide, dt: number): boolean {
  glide.elapsed += dt;
  const t = Math.min(1, glide.elapsed / glide.duration);
  const eased = glide.thrown ? 1 - (1 - t) * (1 - t) : t;
  const segments = glide.points.length - 1;
  const distance = eased * glide.total;
  let i = 0;
  while (i < segments - 1 && glide.cumulative[i + 1]! < distance) i++;
  const legLength = glide.cumulative[i + 1]! - glide.cumulative[i]!;
  const frac = legLength <= 1e-9 ? 1 : (distance - glide.cumulative[i]!) / legLength;
  const a = glide.points[i]!;
  const b = glide.points[i + 1]!;
  const group = glide.token.group;
  if (i === glide.leapLeg) {
    // A jump in three: gathered on the spot, knees bent; through the air, long and thin, over
    // an arc; and the landing taken, squat, where it ends. They face the way they are going.
    const air = Math.min(1, Math.max(0, (frac - LEAP_GATHER) / (LEAP_LAND - LEAP_GATHER)));
    const squat = frac < LEAP_GATHER ? Math.sin((Math.PI * frac) / LEAP_GATHER / 2) : frac > LEAP_LAND ? Math.sin((Math.PI * (frac - LEAP_LAND)) / (1 - LEAP_LAND)) : 0;
    const stretch = Math.sin(Math.PI * air);
    const tall = 1 - 0.24 * squat + 0.14 * stretch;
    group.scale.set(1 / Math.sqrt(tall), tall, 1 / Math.sqrt(tall));
    // The rule's parabola, not a sine: the token flies the line that was drawn for it.
    group.position.set(a.x + (b.x - a.x) * air, a.y + (b.y - a.y) * air + 4 * glide.leapArc * air * (1 - air), a.z + (b.z - a.z) * air);
  } else {
    // A walk takes steps: the token rises and settles twice a tile, so a body without an animation
    // of its own still reads as walking rather than sliding.
    const hop = glide.thrown ? glide.hop * Math.sin(Math.PI * t) : glide.hop * Math.abs(Math.sin(Math.PI * distance * glide.bobs));
    group.position.set(a.x + (b.x - a.x) * frac, a.y + (b.y - a.y) * frac + hop, a.z + (b.z - a.z) * frac);
  }
  if (!glide.thrown) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    if (dx * dx + dz * dz > 1e-12) glide.token.group.rotation.y = Math.atan2(dx, dz);
  }
  if (t < 1) return false;
  const end = glide.points[segments]!;
  glide.token.group.position.set(end.x, end.y, end.z);
  if (glide.leapLeg >= 0) glide.token.group.scale.set(1, 1, 1);
  return true;
}
