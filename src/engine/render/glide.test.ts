import { describe, expect, it } from 'vitest';
import { Group } from 'three';
import { TileGrid } from '../grid/grid';
import { advanceGlide, planGlide } from './glide';
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
    expect(near.hop).toBe(0);
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
