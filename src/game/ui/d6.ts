/**
 * A six-sided die, as geometry.
 *
 * The cube, numbered the way a real d6 is: opposite faces sum to seven. Everything that turns,
 * tumbles and flattens a die lives in `d12.ts` and takes the solid as an argument, so this file is
 * only the six squares - their normals, their corners and what is printed on them.
 *
 * Arithmetic only, no DOM, like the twelve beside it.
 */

import type { Face, Vec } from './d12';

const ROOT3 = Math.sqrt(3);

/** The six axes, each with the number that faces that way, and an up that reads the number upright. */
const SIDES: readonly { value: number; normal: Vec; up: Vec }[] = [
  { value: 1, normal: [0, 0, 1], up: [0, 1, 0] },
  { value: 6, normal: [0, 0, -1], up: [0, 1, 0] },
  { value: 2, normal: [0, 1, 0], up: [0, 0, -1] },
  { value: 5, normal: [0, -1, 0], up: [0, 0, 1] },
  { value: 3, normal: [1, 0, 0], up: [0, 1, 0] },
  { value: 4, normal: [-1, 0, 0], up: [0, 1, 0] },
];

const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * The cube, worked out once.
 *
 * A corner is half a side out along each axis, scaled so the die sits inside a sphere of radius
 * one - the same sphere the twelve sits in, so the two are drawn at the same size. The corners of
 * a face are its centre, plus and minus half a side along the face's own up and across, wound the
 * way a right hand turns about the normal so a view drawing them in order draws the outside.
 */
function build(): Face[] {
  const half = 1 / ROOT3;
  return SIDES.map(({ value, normal, up }) => {
    const across = cross(normal, up);
    const centre: Vec = [normal[0] * half, normal[1] * half, normal[2] * half];
    const corner = (u: number, a: number): Vec => [
      centre[0] + (up[0] * u + across[0] * a) * half,
      centre[1] + (up[1] * u + across[1] * a) * half,
      centre[2] + (up[2] * u + across[2] * a) * half,
    ];
    return { value, normal, centre, up, corners: [corner(1, -1), corner(-1, -1), corner(-1, 1), corner(1, 1)] };
  });
}

/** The six faces, in the order the solid was built. */
export const D6_FACES: readonly Face[] = build();
