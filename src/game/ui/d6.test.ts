/**
 * The cube: six squares, opposite faces summing to seven, and the same sphere as the twelve.
 */

import { describe, expect, it } from 'vitest';
import { D6_FACES } from './d6';
import { draw, landing, FACES } from './d12';

const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

describe('the six', () => {
  it('is six squares, each numbered once, opposite faces summing to seven', () => {
    expect(D6_FACES).toHaveLength(6);
    expect([...D6_FACES].map((f) => f.value).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const face of D6_FACES) {
      expect(face.corners).toHaveLength(4);
      const opposite = D6_FACES.find((other) => dot(other.normal, face.normal) < -0.999)!;
      expect(face.value + opposite.value).toBe(7);
    }
  });

  it('sits in the same sphere as the twelve, so both draw the same size', () => {
    const reach = (faces: typeof D6_FACES): number =>
      Math.max(...faces.flatMap((f) => f.corners.map((c) => Math.hypot(c[0], c[1], c[2]))));
    expect(reach(D6_FACES)).toBeCloseTo(reach(FACES), 6);
  });

  it('turns to the face it is asked for, and shows it to the front', () => {
    for (const value of [1, 2, 3, 4, 5, 6]) {
      expect(draw(landing(value, D6_FACES), D6_FACES).front).toBe(value);
    }
  });

  it('is drawn inside its own outline rather than the twelve of them', () => {
    // The silhouette is what is painted behind the faces. Built from the wrong solid it is bigger
    // than the die, and the difference shows as a dark collar round a cube.
    const drawn = draw(landing(1, D6_FACES), D6_FACES);
    const xs = (points: string): number[] => points.split(' ').map((p) => Number(p.split(',')[0]));
    const rim = xs(drawn.rim);
    const faces = drawn.faces.flatMap((face) => xs(face.points));
    expect(Math.min(...rim)).toBeCloseTo(Math.min(...faces), 6);
    expect(Math.max(...rim)).toBeCloseTo(Math.max(...faces), 6);
  });

  it('draws only the faces that are looking at you: three of a cube at rest', () => {
    const drawn = draw(landing(1, D6_FACES), D6_FACES);
    expect(drawn.faces.length).toBeGreaterThanOrEqual(1);
    expect(drawn.faces.length).toBeLessThanOrEqual(3);
    expect(drawn.rim.length).toBeGreaterThan(0);
  });
});
