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
  /** How high it lifts: once per tile of a walk, once over the whole of a throw. */
  hop: number;
  thrown: boolean;
}

/** Seconds per tile of line for a walk, and what a throw takes whatever it crosses. */
const WALK_PER_TILE = 0.16;
const THROW_SECONDS = 0.25;
const THROW_HOP = 0.35;

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
    const pieces = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.5));
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
  const total = cumulative[cumulative.length - 1]!;
  // A fixed pace per tile of line, however long it is: a walk across the room
  // takes as long as a walk across the room, and a follower crossing five tiles
  // in one leg takes five tiles' worth.
  const crossed = Math.max(1, lineLength(spots));
  return {
    token,
    points,
    cumulative,
    total,
    elapsed: 0,
    duration: thrown ? THROW_SECONDS : WALK_PER_TILE * crossed,
    hop: thrown ? THROW_HOP : 0,
    thrown,
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
  const hop = glide.thrown ? glide.hop * Math.sin(Math.PI * t) : 0;
  glide.token.group.position.set(a.x + (b.x - a.x) * frac, a.y + (b.y - a.y) * frac + hop, a.z + (b.z - a.z) * frac);
  if (!glide.thrown) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    if (dx * dx + dz * dz > 1e-12) glide.token.group.rotation.y = Math.atan2(dx, dz);
  }
  if (t < 1) return false;
  const end = glide.points[segments]!;
  glide.token.group.position.set(end.x, end.y, end.z);
  return true;
}
