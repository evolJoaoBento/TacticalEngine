/**
 * New Game's minis on the table (`mini-table.ts`). The drawing needs a browser, and the e2e test picks
 * a mini up, puts it down, lines them up, takes one up close and turns it, and chooses one; what is
 * driven here is what decides where they stand and how they turn - the line, the camera over it, the
 * way on from the left, the hold up close, the turn a drag gives, and the hit.
 */

import { describe, expect, it } from 'vitest';
import { Ray, Vector3 } from 'three';
import { baseOf, enterX, facingUp, fitDistance, inspectDistance, leftEdge, lineUp, miniUnder, spacingFor, spun, turnedBy } from './mini-table';

describe('the line the minis stand in', () => {
  it('is centred on the table, evenly spaced', () => {
    const line = lineUp(3, 2);
    expect(line.map((spot) => spot.x)).toEqual([-2, 0, 2]);
    expect(line.every((spot) => spot.z === 0)).toBe(true);
    expect(lineUp(1)).toEqual([{ x: 0, z: 0 }]);
  });

  it('spreads for wide figures, so none of them touch', () => {
    expect(spacingFor(0.3)).toBe(spacingFor(0.1));
    expect(spacingFor(1.2)).toBeGreaterThan(2 * 1.2 * 0.8);
    expect(spacingFor(1.2)).toBeGreaterThan(spacingFor(0.3));
  });

  it('puts a name plate at the base, not at the tip of a spear or a cloak', () => {
    expect(baseOf({ height: 2, reach: 0.4 })).toBe(0.4);
    expect(baseOf({ height: 2, reach: 1.5 })).toBeCloseTo(0.6);
  });
});

describe('the camera over the table', () => {
  it('hangs higher for a longer line, and higher on a narrower screen', () => {
    expect(fitDistance(12, 1.6)).toBeGreaterThan(fitDistance(6, 1.6));
    expect(fitDistance(12, 0.8)).toBeGreaterThan(fitDistance(12, 1.6));
  });

  it('sees the whole line between the edges of the view', () => {
    const span = 10;
    const distance = fitDistance(span, 1.6);
    expect(-leftEdge(distance, 1.6)).toBeGreaterThan(span / 2);
    expect(-leftEdge(distance, 1.6)).toBeLessThan(span);
  });
});

describe('a mini coming onto the table', () => {
  it('waits off the left edge, comes on, slows, and stands at its place', () => {
    const from = -12;
    expect(enterX(-0.2, from, 3)).toBe(from);
    const way = [0.1, 0.2, 0.3, 0.4, 0.5].map((t) => enterX(t, from, 3));
    for (let i = 1; i < way.length; i++) expect(way[i]!).toBeGreaterThan(way[i - 1]!);
    // Slowing as it arrives: the last stretch is shorter than the first.
    expect(way[4]! - way[3]!).toBeLessThan(way[1]! - way[0]!);
    expect(enterX(5, from, 3)).toBe(3);
  });
});

describe('a mini taken up close', () => {
  it('is held nearer the camera the smaller it is', () => {
    expect(inspectDistance({ height: 1, reach: 0.3 })).toBeLessThan(inspectDistance({ height: 2, reach: 0.3 }));
  });

  it('faces the player to begin with: its head at the top of the view, its front toward the camera', () => {
    const turn = facingUp();
    expect(new Vector3(0, 1, 0).applyQuaternion(turn).z).toBeCloseTo(-1);
    expect(new Vector3(0, 0, 1).applyQuaternion(turn).y).toBeCloseTo(1);
    expect(turnedBy(turn)).toBeCloseTo(0);
  });

  it('turns the way it is dragged, left or right: its near side goes with the pointer', () => {
    const right = spun(facingUp(), 40);
    expect(new Vector3(0, 0, 1).applyQuaternion(right).x).toBeGreaterThan(0.3);
    const left = spun(facingUp(), -40);
    expect(new Vector3(0, 0, 1).applyQuaternion(left).x).toBeLessThan(-0.3);
    expect(turnedBy(right)).toBeCloseTo(40 * 0.011 * (180 / Math.PI), 0);
  });

  it('turns about its upright only: however far it is turned, its head stays at the top of the view', () => {
    let turn = facingUp();
    for (let i = 0; i < 20; i++) turn = spun(turn, Math.PI / 0.011 / 20);
    // A half-turn shows its back.
    expect(new Vector3(0, 0, 1).applyQuaternion(turn).y).toBeCloseTo(-1);
    for (const dx of [37, -250, 900]) {
      turn = spun(turn, dx);
      const head = new Vector3(0, 1, 0).applyQuaternion(turn);
      expect(head.z).toBeCloseTo(-1);
    }
  });
});

describe('the mini a pointer is on', () => {
  const eye = new Vector3(0, 12, 0.001);
  const toward = (x: number, y: number, z: number) => new Ray(eye.clone(), new Vector3(x, y, z).sub(eye).normalize());
  const two = [
    { id: 'left', x: -2, z: 0, y: 0, height: 2, reach: 0.4 },
    { id: 'right', x: 2, z: 0, y: 0, height: 2, reach: 0.4 },
  ];

  it('is the one under it, seen from above', () => {
    expect(miniUnder(toward(-2, 1, 0), two)).toBe('left');
    expect(miniUnder(toward(2, 0, 0.2), two)).toBe('right');
  });

  it('is none between them', () => {
    expect(miniUnder(toward(0, 0, 0), two)).toBeNull();
    expect(miniUnder(toward(-2, 0, 3), two)).toBeNull();
  });

  it('is the nearer of two when one is held up over the other', () => {
    const held = [{ ...two[0]!, id: 'held', y: 2.5 }, two[0]!];
    expect(miniUnder(toward(-2, 3, 0), held)).toBe('held');
    expect(miniUnder(toward(-2, 3, 0), [two[0]!])).toBe('left');
  });
});
