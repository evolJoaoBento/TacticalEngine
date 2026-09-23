/**
 * A step through a portal, drawn.
 *
 * A portal is not a walk across the room, so a token going through one does not glide there: it
 * winds down to nothing where it stood, spinning, and winds back up where it comes out, spinning
 * the rest of the way round. Pure posing over a three object and a clock, so it is tested headless.
 */

import type { Object3D } from 'three';

/** How long the whole blink takes, out and back in. */
export const BLINK_SECONDS = 0.6;

/** How far it turns while it goes, and again while it comes back: a full turn each way. */
const SPIN = Math.PI * 2;

/** Never quite nothing: a scale of zero is a matrix with no inverse, which a raycast chokes on. */
const SMALLEST = 0.001;

type Point = { x: number; y: number; z: number };

/** Where a token blinks from and to, the size and facing it has at rest. */
export interface Blink {
  from: Point;
  to: Point;
  scale: Point;
  facing: number;
}

/** A blink from `from` to where the token already stands, at the size and facing it stands at. */
export function startBlink(group: Object3D, from: Point): Blink {
  return {
    from: { x: from.x, y: from.y, z: from.z },
    to: { x: group.position.x, y: group.position.y, z: group.position.z },
    scale: { x: group.scale.x, y: group.scale.y, z: group.scale.z },
    facing: group.rotation.y,
  };
}

const ease = (t: number): number => t * t * (3 - 2 * t);

/** Pose the token `t` (0..1) of the way through: going for the first half, coming back for the second. */
export function poseBlink(group: Object3D, blink: Blink, t: number): void {
  const going = t < 0.5;
  const half = going ? t * 2 : t * 2 - 1;
  const size = Math.max(SMALLEST, going ? 1 - ease(half) : ease(half));
  const at = going ? blink.from : blink.to;
  group.position.set(at.x, at.y, at.z);
  group.scale.set(blink.scale.x * size, blink.scale.y * size, blink.scale.z * size);
  // Faster as it shrinks and slower as it grows, so it seems to be pulled through and let go.
  group.rotation.y = blink.facing + SPIN * (going ? half * half : 1 + (1 - (1 - half) * (1 - half)));
}

/** Where the blink leaves it: standing where it came out, its own size, facing the way it did. */
export function restFromBlink(group: Object3D, blink: Blink): void {
  group.position.set(blink.to.x, blink.to.y, blink.to.z);
  group.scale.set(blink.scale.x, blink.scale.y, blink.scale.z);
  group.rotation.y = blink.facing;
}
