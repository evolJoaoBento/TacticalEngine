/**
 * The numbers that rise over heads: "-2 HP", "+1 Light", the name of a condition as it lands.
 *
 * They are plain DOM over the canvas rather than anything in the scene, because they are text and
 * text in a 3D scene is a sprite atlas and a font and a pile of work to end up less readable. What
 * makes them look attached to the board is this: every frame each one is put back over the head it
 * belongs to, so it follows a character who is walking, thrown, or shoved while it rises.
 *
 * Lifted out of `main.ts`, which is over its readability ceiling and may only get smaller. It is
 * handed the two things it cannot know - where a character is, and where a point on the board
 * lands on screen - so it needs neither the scene nor the camera.
 */

import type { Spot } from '../../engine/grid/grid';

/** One number on its way up. */
export interface LiveFloater {
  el: HTMLDivElement;
  /** Whose head it rises over: it follows them, walking or thrown. */
  id: string;
  /** How many were already rising over them when this one was born. */
  stack: number;
  born: number;
}

/** How long one lives, in seconds. Long enough to read at a glance, short enough not to queue. */
export const FLOATER_LIFE = 1.4;

/** How far up one climbs a second, and how far apart two over the same head sit, in pixels. */
const RISE = 36;
const STACKED = 18;
/** When it starts fading, in seconds: it is read first and fades after. */
const HOLDS = 0.7;

/**
 * Move every rising number, and let go of the ones that have risen or whose owner has left.
 *
 * `live` is edited in place, because the caller owns the list and the elements are in the page:
 * one that is dropped has to be taken out of the DOM at the same moment it is taken out of here.
 */
export function driveFloaters(
  now: number,
  live: LiveFloater[],
  where: (id: string) => Spot | null,
  screenAt: (spot: Spot, height: number) => { x: number; y: number },
): void {
  for (let i = live.length - 1; i >= 0; i--) {
    const floater = live[i]!;
    const age = (now - floater.born) / 1000;
    const over = age > FLOATER_LIFE ? null : where(floater.id);
    if (over === null) {
      floater.el.remove();
      live.splice(i, 1);
      continue;
    }
    const at = screenAt(over, 1.3);
    floater.el.style.left = `${at.x}px`;
    floater.el.style.top = `${at.y - age * RISE - floater.stack * STACKED}px`;
    floater.el.style.opacity = `${Math.max(0, 1 - Math.max(0, age - HOLDS) / (FLOATER_LIFE - HOLDS))}`;
  }
}
