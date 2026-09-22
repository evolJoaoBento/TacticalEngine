import { describe, expect, it } from 'vitest';
import { Group } from 'three';
import { TileGrid } from '../grid/grid';
import { advanceGlide, LEAP_SECONDS, WALK_PER_TILE, planGlide } from './glide';
import { DEFAULT_LAYOUT, spotToWorld } from './layout';
import type { BuiltModel } from './procedural/build';

/**
 * The drawing of a journey, as numbers.
 *
 * Nothing here decides where a creature is — the state already has it there —
 * so what matters is the shape of the trip: it starts where the token stands,
 * ends exactly where it is going, takes longer the further it goes, and a throw
 * arcs where a walk does not.
 */

const grid = new TileGrid({ width: 6, height: 6 });

/** A token standing at a spot, with only what a glide reads off it. */
function standing(at: { x: number; y: number }): BuiltModel {
  const group = new Group();
  const world = spotToWorld(grid, at, DEFAULT_LAYOUT);
  group.position.set(world.x, world.y, world.z);
  return { group, spec: { groundOffset: 0 }, named: new Map(), hooks: new Map() } as unknown as BuiltModel;
}

const walkTo = (from: { x: number; y: number }, to: { x: number; y: number }) =>
  planGlide(grid, DEFAULT_LAYOUT, standing(from), from, to, undefined, undefined, false);

describe('planning a walk', () => {
  it('starts where the token stands and ends where it is going', () => {
    const from = { x: 1, y: 1 };
    const to = { x: 4, y: 1 };
    const glide = walkTo(from, to);
    const start = spotToWorld(grid, from, DEFAULT_LAYOUT);
    const end = spotToWorld(grid, to, DEFAULT_LAYOUT);
    expect(glide.points[0]!.x).toBeCloseTo(start.x, 10);
    expect(glide.points[0]!.z).toBeCloseTo(start.z, 10);
    const last = glide.points[glide.points.length - 1]!;
    expect(last.x).toBeCloseTo(end.x, 10);
    expect(last.z).toBeCloseTo(end.z, 10);
    // Cut into legs of half a tile, so the height follows the ground beneath it.
    expect(glide.points.length).toBeGreaterThan(2);
    expect(glide.total).toBeCloseTo(3 * DEFAULT_LAYOUT.tileSize, 6);
  });

  it('takes a fixed pace per tile of line, so further is longer', () => {
    const near = walkTo({ x: 1, y: 1 }, { x: 2, y: 1 });
    const far = walkTo({ x: 1, y: 1 }, { x: 5, y: 1 });
    expect(far.duration).toBeCloseTo(near.duration * 4, 6);
    expect(near.thrown).toBe(false);
    // A walk takes steps rather than sliding: it rises a little, twice a tile.
    expect(near.hop).toBeGreaterThan(0);
    expect(near.bobs).toBeCloseTo(2 / DEFAULT_LAYOUT.tileSize, 6);
  });

  it('keeps its pace when a second walk is asked for mid-stride', () => {
    // A click, and another before the first is drawn: the token is still short of where its own
    // character already stands, so the new journey is longer than the line the walk was planned
    // along. Timed by the line it would slide to catch up; timed by the ground, it walks.
    const from = { x: 1, y: 1 };
    const first = walkTo(from, { x: 5, y: 1 });
    const token = standing(from);
    // Drawn a quarter of the way there, and then sent somewhere else.
    advanceGlide(first, first.duration / 4);
    token.group.position.copy(first.token.group.position);
    const again = planGlide(grid, DEFAULT_LAYOUT, token, { x: 5, y: 1 }, { x: 5, y: 5 }, undefined, [{ x: 5, y: 1 }, { x: 5, y: 5 }], false);
    const pace = again.total / DEFAULT_LAYOUT.tileSize / again.duration;
    expect(pace).toBeCloseTo(1 / WALK_PER_TILE, 6);
    // The catch-up is part of the journey, so it takes longer than the line alone would.
    expect(again.duration).toBeGreaterThan(WALK_PER_TILE * 4);
  });

  it('follows the path it was handed, corner by corner', () => {
    const from = { x: 1, y: 1 };
    const to = { x: 3, y: 3 };
    const route = [from, { x: 1, y: 3 }, to];
    const glide = planGlide(grid, DEFAULT_LAYOUT, standing(from), from, to, undefined, route, false);
    // Round the corner rather than across it: the line is longer than the crow's.
    expect(glide.total).toBeGreaterThan(Math.hypot(2, 2) * DEFAULT_LAYOUT.tileSize);
  });
});

describe('walking it', () => {
  it('arrives exactly, and says so', () => {
    const glide = walkTo({ x: 1, y: 1 }, { x: 4, y: 1 });
    expect(advanceGlide(glide, glide.duration / 2)).toBe(false);
    const half = glide.token.group.position.x;
    expect(advanceGlide(glide, glide.duration)).toBe(true);
    const end = glide.points[glide.points.length - 1]!;
    expect(glide.token.group.position.x).toBeCloseTo(end.x, 10);
    expect(glide.token.group.position.z).toBeCloseTo(end.z, 10);
    // It was actually on its way before it got there.
    expect(half).toBeGreaterThan(glide.points[0]!.x);
    expect(half).toBeLessThan(end.x);
  });

  it('faces the way it is going', () => {
    const glide = walkTo({ x: 1, y: 1 }, { x: 4, y: 1 });
    advanceGlide(glide, glide.duration / 3);
    expect(glide.token.group.rotation.y).toBeCloseTo(Math.PI / 2, 6);
  });

  it('a throw arcs over the line and lands on it', () => {
    const from = { x: 1, y: 1 };
    const to = { x: 4, y: 1 };
    const glide = planGlide(grid, DEFAULT_LAYOUT, standing(from), from, to, undefined, undefined, true);
    expect(glide.thrown).toBe(true);
    expect(glide.duration).toBeLessThan(walkTo(from, to).duration);
    const ground = glide.points[0]!.y;
    advanceGlide(glide, glide.duration / 2);
    // Over the line half way, back on it at the end.
    expect(glide.token.group.position.y).toBeGreaterThan(ground + 0.1);
    expect(advanceGlide(glide, glide.duration)).toBe(true);
    expect(glide.token.group.position.y).toBeCloseTo(glide.points[glide.points.length - 1]!.y, 10);
  });
});

describe('a jump at the end of a walk', () => {
  /** A board with a block two tiles east of the start: the walk goes one tile, and the jump the next. */
  const raised = new TileGrid({ width: 6, height: 6 });
  raised.lift[raised.indexOf(3, 1)] = 1;
  const route = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }];
  const plan = (leap: boolean) => {
    const lift = leap ? 0.75 : undefined;
    const group = new Group();
    const world = spotToWorld(raised, route[0]!, DEFAULT_LAYOUT);
    group.position.set(world.x, world.y, world.z);
    const token = { group, spec: { groundOffset: 0 }, named: new Map(), hooks: new Map() } as unknown as BuiltModel;
    return { token, glide: planGlide(raised, DEFAULT_LAYOUT, token, route[0]!, route[2]!, undefined, route, false, lift) };
  };

  it('is one leg, the last, and takes its own time on top of the walk', () => {
    const { glide } = plan(true);
    const walked = plan(false).glide;
    expect(glide.leapLeg).toBe(glide.points.length - 2);
    expect(walked.leapLeg).toBe(-1);
    // One tile walked, then the jump: the walk's pace for the one, and the jump's own time.
    expect(glide.duration).toBeCloseTo(walked.duration / 2 + LEAP_SECONDS, 6);
    expect(glide.leapArc).toBeCloseTo(0.75, 6);
  });

  it('gathers on the spot, leaves the ground over an arc, and lands square where it was going', () => {
    const { token, glide } = plan(true);
    const foot = spotToWorld(raised, route[1]!, DEFAULT_LAYOUT);
    const top = spotToWorld(raised, route[2]!, DEFAULT_LAYOUT);
    const walk = glide.duration - LEAP_SECONDS;
    let highest = -Infinity;
    let squattest = 1;
    let tallest = 1;
    let gatheredAt: number | null = null;
    let elapsed = 0;
    let arrived = false;
    while (!arrived) {
      arrived = advanceGlide(glide, 0.01);
      elapsed += 0.01;
      const { position, scale } = token.group;
      highest = Math.max(highest, position.y);
      squattest = Math.min(squattest, scale.y);
      tallest = Math.max(tallest, scale.y);
      // A tenth of the way into the jump they have not left the foot of the block: they are gathering.
      if (gatheredAt === null && elapsed > walk + LEAP_SECONDS * 0.1) gatheredAt = position.x;
    }
    expect(gatheredAt).toBeCloseTo(foot.x, 2);
    // Three quarters of a block over the line between its ends, which peaks past the top of the block.
    expect(highest).toBeGreaterThan(top.y + 0.2);
    expect(squattest).toBeLessThan(0.85);
    expect(tallest).toBeGreaterThan(1.08);
    expect(token.group.position.x).toBeCloseTo(top.x, 6);
    expect(token.group.position.y).toBeCloseTo(top.y, 6);
    expect(token.group.scale.toArray()).toEqual([1, 1, 1]);
  });

  it('is a walk like any other when nobody said it was a jump', () => {
    const { token, glide } = plan(false);
    let tallest = 1;
    while (!advanceGlide(glide, 0.01)) tallest = Math.max(tallest, token.group.scale.y);
    expect(tallest).toBe(1);
  });
});
