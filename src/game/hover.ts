/**
 * What the pointer would do, as a line on the ground.
 *
 * Three different clicks draw a line: on an adversary, the walk up to where the weapon reaches
 * from before the swing; on bare ground, the walk; on anything else - an ally, a thing to use -
 * nothing, because those are not walks and a line under them would promise one.
 *
 * Lifted out of `main.ts`, which is over its readability ceiling and may only get smaller. The
 * decision is all about the scene and what is under the pointer, none of it about three.js, so it
 * belongs here and is testable without a canvas. What it hands back is what to draw; the caller
 * owns the drawing.
 */

import type { Spot } from '../engine/grid/grid';
import { previewStrike, previewWalk } from './movement';
import type { DemoScene } from './demo-scene';

/** The line to draw, or nothing to draw. */
export interface HoverLine {
  route: readonly Spot[];
  beyond: readonly Spot[];
  run: boolean;
}

/** What the caller knows about what a point on the board holds. */
export interface UnderPointer {
  entityNear(spot: Spot): string | null;
  entityOn(tile: number): string | null;
  objectOn(tile: number): string | null;
}

/**
 * The line for a point on the board.
 *
 * `from` is where the figure is actually standing: part-way through a walk that is not the tile
 * the document holds, and the line has to start from the body the player is looking at, because a
 * click will land them there first (`game/land.ts`).
 */
export function hoverLine(demo: DemoScene, ground: { tile: number; spot: Spot }, under: UnderPointer, from: Spot | null): HoverLine | null {
  const near = under.entityNear(ground.spot) ?? [under.entityOn(ground.tile)].find((id) => id !== demo.party.selected) ?? null;
  if (near !== null) {
    if (demo.state.entity(near)?.faction !== 'adversary') return null;
    const route = previewStrike(demo, near);
    return route === null ? null : { route, beyond: [], run: false };
  }
  if (under.objectOn(ground.tile) !== null) return null;
  return previewWalk(demo, ground.tile, ground.spot, from ?? undefined);
}
