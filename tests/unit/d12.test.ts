import { describe, expect, it } from 'vitest';
import { FACES, apply, draw, faceOf, landing, tumble, type Turn, type Vec } from '../../src/game/ui/d12';

/**
 * The dice are drawn as the solid they are.
 *
 * The tray used to draw a pentagon with five facets painted round it, which read
 * as a badge rather than a die. What replaced it is a real dodecahedron turned in
 * three dimensions, so these are the properties that make one: twelve pentagons,
 * numbered the way a die in a hand is numbered, and a throw that ends showing the
 * face the rules already rolled.
 */

const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const minus = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const rowsOf = (turn: Turn): Vec[] => [[turn[0], turn[1], turn[2]], [turn[3], turn[4], turn[5]], [turn[6], turn[7], turn[8]]];
/** Numbers out of an SVG `matrix(...)`. */
const matrix = (label: string): number[] => label.slice('matrix('.length, -1).split(',').map(Number);

describe('the twelve-sided die', () => {
  it('is twelve pentagons on a sphere, numbered so opposite faces make thirteen', () => {
    expect(FACES).toHaveLength(12);
    expect([...FACES].map((face) => face.value).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const face of FACES) {
      expect(face.corners).toHaveLength(5);
      for (const corner of face.corners) expect(Math.hypot(...corner)).toBeCloseTo(1, 10);
      // The number reads up towards a corner, in the face's own plane.
      expect(dot(face.up, face.normal)).toBeCloseTo(0, 10);
      const opposite = FACES.find((other) => dot(other.normal, face.normal) < -0.999);
      expect(face.value + opposite!.value).toBe(13);
    }
  });

  it('rounds every face the same way, so a view draws the outside of the die', () => {
    for (const face of FACES) {
      const [a, b, c] = face.corners;
      expect(dot(cross(minus(b!, a!), minus(c!, b!)), face.normal)).toBeGreaterThan(0);
    }
  });
});

describe('a die at rest', () => {
  it('shows the number it rolled, upright and leaning, with six faces in sight', () => {
    for (let value = 1; value <= 12; value++) {
      const turn = landing(value);
      const drawn = draw(turn);
      expect(drawn.front).toBe(value);
      // Face towards the watcher, number the right way up, and tipped enough to read as a solid.
      expect(apply(turn, faceOf(value).normal)[2]).toBeGreaterThan(0.9);
      expect(apply(turn, faceOf(value).up)[1]).toBeGreaterThan(0.8);
      expect(drawn.faces).toHaveLength(6);
      expect(drawn.faces.map((face) => face.value)).toContain(value);
      const drawnNumbers = drawn.faces.flatMap((face) => face.points.split(/[ ,]/).map(Number));
      for (const n of [...drawnNumbers, ...drawn.rim.split(/[ ,]/).map(Number)]) {
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(100);
      }
    }
  });

  it('is outlined by its own silhouette, a ring of ten corners or more', () => {
    const rim = draw(landing(7)).rim.split(' ');
    expect(rim.length).toBeGreaterThanOrEqual(10);
    expect(rim.length).toBeLessThanOrEqual(20);
  });

  it('carries each number on its face, squashed the way the face is', () => {
    const drawn = draw(landing(4));
    const front = drawn.faces.find((face) => face.value === 4)!;
    const area = (label: string): number => {
      const [a, b, c, d] = matrix(label);
      return Math.abs(a! * d! - b! * c!);
    };
    for (const number of matrix(front.label)) expect(Number.isFinite(number)).toBe(true);
    // A face turned away from the watcher shows its number narrower than the one facing them.
    for (const face of drawn.faces) {
      if (face.value !== 4) expect(area(face.label)).toBeLessThan(area(front.label));
    }
  });
});

describe('a die in the air', () => {
  it('lands exactly where it comes to rest, however long the throw', () => {
    for (let value = 1; value <= 12; value++) {
      expect(tumble(value, 3, 1)).toEqual(landing(value));
      // Past the end and before the start are both still the throw.
      expect(tumble(value, 3, 1.4)).toEqual(landing(value));
      expect(draw(tumble(value, 9, 0.999)).front).toBe(value);
    }
  });

  it('is the same throw twice, and a different one for a different roll', () => {
    expect(tumble(7, 12, 0.35)).toEqual(tumble(7, 12, 0.35));
    expect(tumble(7, 13, 0.35)).not.toEqual(tumble(7, 12, 0.35));
  });

  it('only ever turns: it is never squashed or mirrored on the way down', () => {
    for (const t of [0, 0.15, 0.4, 0.75, 0.95]) {
      const rows = rowsOf(tumble(5, 4, t));
      for (const row of rows) expect(Math.hypot(...row)).toBeCloseTo(1, 10);
      expect(dot(rows[0]!, rows[1]!)).toBeCloseTo(0, 10);
      expect(dot(rows[1]!, rows[2]!)).toBeCloseTo(0, 10);
      // Right-handed, so the die is a die and not its own reflection.
      expect(dot(cross(rows[0]!, rows[1]!), rows[2]!)).toBeCloseTo(1, 10);
      expect(draw(tumble(5, 4, t)).faces.length).toBeGreaterThanOrEqual(3);
    }
  });
});
