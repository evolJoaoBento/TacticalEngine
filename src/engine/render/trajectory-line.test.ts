import { describe, it, expect } from 'vitest';
import type { BufferAttribute, Line } from 'three';
import { TileGrid } from '../grid/grid';
import { arcHeight } from '../rules/jump';
import { DEFAULT_LAYOUT, spotToWorld } from './layout';
import { TrajectoryLine } from './trajectory-line';

/** The arc a jump is aimed along, as numbers: it is the rule's own curve, and it says yes or no in colour. */
describe('the jump arc on the board', () => {
  const grid = new TileGrid({ width: 8, height: 4 });
  grid.lift[grid.indexOf(5, 1)] = 2;
  const pointsOf = (line: TrajectoryLine): { x: number; y: number; z: number }[] => {
    const positions = (line.group.children[0] as Line).geometry.getAttribute('position') as BufferAttribute;
    return Array.from({ length: positions.count }, (_, i) => ({ x: positions.getX(i), y: positions.getY(i), z: positions.getZ(i) }));
  };

  it('is hidden until there is something to aim at, and hidden again after', () => {
    const line = new TrajectoryLine(1);
    expect(line.showing).toBeNull();
    line.show(grid, DEFAULT_LAYOUT, { from: { x: 1, y: 1 }, to: { x: 4, y: 1 }, lift: 1, ok: true });
    expect(line.showing).toBe('ok');
    line.show(grid, DEFAULT_LAYOUT, { from: { x: 1, y: 1 }, to: { x: 4, y: 1 }, lift: 1, ok: false });
    expect(line.showing).toBe('blocked');
    line.show(grid, DEFAULT_LAYOUT, null);
    expect(line.showing).toBeNull();
    line.dispose();
  });

  it('runs from whoever is jumping to the landing, over the curve the rule checks the ground against', () => {
    const line = new TrajectoryLine(1);
    const from = { x: 1, y: 1 };
    const to = { x: 5, y: 1 };
    line.show(grid, DEFAULT_LAYOUT, { from, to, lift: 2.4, ok: true });
    const points = pointsOf(line);
    const a = spotToWorld(grid, from, DEFAULT_LAYOUT);
    const b = spotToWorld(grid, to, DEFAULT_LAYOUT);
    expect(points[0]!.x).toBeCloseTo(a.x, 6);
    expect(points.at(-1)!.x).toBeCloseTo(b.x, 6);
    // It lands on top of the two blocks, not on the floor under them.
    expect(points.at(-1)!.y).toBeCloseTo(b.y, 6);
    expect(b.y - a.y).toBeCloseTo(2, 6);
    const mid = points[(points.length - 1) / 2]!;
    expect(mid.y).toBeGreaterThanOrEqual(arcHeight(a.y, b.y, 2.4, 0.5));
    expect(Math.max(...points.map((p) => p.y))).toBeGreaterThan(b.y);
    expect(line.walkPoints).toBe(0);
    // The ring marks the landing.
    expect(line.group.children[1]!.position.x).toBeCloseTo(b.x, 6);
    line.dispose();
  });

  it('lays the walk before the jump along the ground, and wears an X where no jump can be made', () => {
    const line = new TrajectoryLine(1);
    const x = (): boolean => line.group.children[1]!.children[0]!.visible;
    line.show(grid, DEFAULT_LAYOUT, { walk: [{ x: 0, y: 1 }, { x: 2, y: 1 }], from: { x: 2, y: 1 }, to: { x: 4, y: 1 }, lift: 0.75, ok: true });
    // Two tiles in half-tile legs: five points.
    expect(line.walkPoints).toBe(5);
    expect(x()).toBe(false);
    line.show(grid, DEFAULT_LAYOUT, { walk: [], from: { x: 0, y: 1 }, to: { x: 7, y: 1 }, lift: 2.4, ok: false });
    expect(line.walkPoints).toBe(0);
    expect(x()).toBe(true);
    line.dispose();
  });
});
