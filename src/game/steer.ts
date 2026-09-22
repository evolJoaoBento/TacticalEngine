/**
 * Walking by holding the button down: where the next step goes.
 *
 * A click sends somebody to a spot. Holding the button instead steers them: while it is down they
 * walk towards wherever the pointer is, a short step at a time, and the camera keeps them in the
 * middle of the view. That is how a party is walked across a wood, rather than clicking twenty
 * times along the trail.
 *
 * Each step is as long as the walking it stands for - the time since the last one, at the pace a
 * token is drawn walking - so holding the button covers the ground at exactly the speed a click
 * does, and no faster. Sizing the step by distance instead would run the character's real position
 * away from the token drawing it, which looks like a sprint and is one. In a fight the step is kept inside the circle the fighter moves
 * freely in, so steering never asks for a push: pushing out is a roll, and a roll is a decision
 * somebody makes with a click, not by leaning on the mouse.
 *
 * DOM-free, like the rest of `game/`: `main.ts` reads the pointer and does the walking.
 */

import type { Spot } from '../engine/grid/grid';
// The pace a walk is drawn at, which is the pace a steered walk moves at: the two have to agree.
import { WALK_PER_TILE } from '../engine/render/glide';
import { movementCircle } from './circle';
import type { DemoScene } from './demo-scene';
import { inCombat } from './moment';

/** The most one step may cover, in tiles: a frame lost to something else must not become a leap. */
export const STEER_MOST = 1.2;
/** How near the pointer counts as arrived, so a character does not shuffle on the spot under it. */
export const STEER_STOP = 0.55;
/** How long the button is down before a press becomes steering rather than a click, in milliseconds. */
export const STEER_HOLD = 180;
/** How often a steered walk asks for its next step, in milliseconds. */
export const STEER_EVERY = 110;

type Steered = Pick<DemoScene, 'state' | 'party' | 'encounter' | 'pending' | 'ambush'>;

/**
 * The spot the next step of a steered walk should go to, given how long it stands for, or null when
 * there is nothing to do: nobody to command, a prompt waiting, or the pointer under their feet.
 */
export function steerStep(demo: Steered, toward: Spot, seconds: number): Spot | null {
  const id = demo.party.selected;
  if (id === null || demo.pending !== null || demo.ambush !== null || !demo.party.canCommand(id)) return null;
  const stood = demo.state.entity(id);
  if (stood === undefined) return null;
  const away = Math.hypot(toward.x - stood.at.x, toward.y - stood.at.y);
  if (away < STEER_STOP) return null;
  const reach = Math.min(away, Math.max(0, seconds) / WALK_PER_TILE, STEER_MOST);
  if (reach <= 0) return null;
  const step = { x: stood.at.x + ((toward.x - stood.at.x) * reach) / away, y: stood.at.y + ((toward.y - stood.at.y) * reach) / away };
  return inCombat(demo) ? insideTheCircle(demo, id, stood.at, step) : step;
}

/**
 * A step in a fight, kept inside the circle: pulled back to the edge when it would cross it, and
 * refused outright when there is no room left to walk. Leaving the circle is a push, and a push is
 * asked for with a click.
 */
function insideTheCircle(demo: Steered, id: string, from: Spot, step: Spot): Spot | null {
  const circle = movementCircle(demo, id);
  if (circle === null) return step;
  const edge = circle.radius - 0.05;
  const out = Math.hypot(step.x - circle.anchor.x, step.y - circle.anchor.y);
  if (out <= edge) return step;
  const pulled = { x: circle.anchor.x + ((step.x - circle.anchor.x) * edge) / out, y: circle.anchor.y + ((step.y - circle.anchor.y) * edge) / out };
  return Math.hypot(pulled.x - from.x, pulled.y - from.y) < STEER_STOP ? null : pulled;
}
