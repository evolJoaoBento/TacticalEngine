/**
 * Where a fighter may move this spotlight: a circle, and the wider one a roll would open.
 *
 * In a fight nobody counts squares. A character moves freely inside a circle of Close range
 * round where they stood when the spotlight came to the party - again and again, at no cost -
 * and to go past its edge they make an Agility Roll that pushes the circle out one distance
 * step, Close to Far to Very Far, for the rest of the spotlight. A failure hands the spotlight
 * to the GM and moves nobody. The runner keeps the circles (`EncounterRunner.circleOf`); this
 * is what the game reads off them, in tiles, and what the board draws.
 */

import type { Spot } from '../engine/grid/grid';
import type { Circle } from '../engine/grid/walk';
import { bandLabel, maxSpanForBand, type RangeBand } from '../engine/rules/range';
import { jumpRange } from '../engine/rules/jump';
import { DEMO_BAND_TILES, jumpRulesFor } from './demo-rules';
import type { DemoScene } from './demo-scene';
import { inCombat } from './moment';

type Fight = Pick<DemoScene, 'encounter' | 'state'>;

/** A circle on the ground with the band it is. */
export interface MovementCircle extends Circle {
  readonly band: RangeBand;
}

/** The circle a fighter moves freely in right now; null out of a fight, or for anybody who has none. */
export function movementCircle(demo: Fight, id: string): MovementCircle | null {
  if (!inCombat(demo)) return null;
  const circle = demo.encounter!.circleOf(id);
  if (circle === null) return null;
  const radius = maxSpanForBand(circle.band, DEMO_BAND_TILES);
  // Standing outside it - shoved, or put somewhere by a script - the circle is where they are now.
  const stood = demo.state.entity(id);
  if (stood !== undefined && Math.hypot(stood.at.x - circle.anchor.x, stood.at.y - circle.anchor.y) > radius + 1e-6) demo.encounter!.reanchor(id);
  return { anchor: circle.anchor, band: circle.band, radius };
}

/** How a fighter's walk is asked for: inside their circle, and with no count of squares against it. */
export function fightWalk(demo: Fight, id: string): { inCombat: true; budget: number; within?: Circle } {
  const within = movementCircle(demo, id);
  return { inCombat: true, budget: Infinity, ...(within === null ? {} : { within }) };
}

/** The circle a push would open for a fighter: one step out from their own, or null past Very Far. */
export function pushCircle(demo: Fight, id: string): MovementCircle | null {
  const circle = movementCircle(demo, id);
  const band = demo.encounter?.pushOpens(id) ?? null;
  return circle === null || band === null ? null : { anchor: circle.anchor, band, radius: maxSpanForBand(band, DEMO_BAND_TILES) };
}

/** What the roll asks, and what it warns: the band it opens, and what a failure costs. */
export function pushPrompt(name: string, band: RangeBand): string {
  return `Push past ${bandLabel(band === 'far' ? 'close' : band === 'veryFar' ? 'far' : band)} range: an Agility Roll opens ${bandLabel(band)} range to ${name} for the rest of the turn. On a failure nobody moves, the spotlight passes to the GM, and the turn is over.`;
}

/** A circle to draw. */
export interface DrawnRing {
  at: Spot;
  radius: number;
  kind: 'move' | 'push' | 'jump';
}

/**
 * The rings to draw for whoever is selected: in a fight their circle and the push a roll would
 * open; and, while a jump is being aimed, its reach round where they stand. Nothing otherwise.
 */
export function reachRings(demo: Fight & Pick<DemoScene, 'party' | 'state' | 'characters' | 'project'>, jumping: boolean): DrawnRing[] {
  const id = demo.party.selected;
  const stood = id === null ? undefined : demo.state.entity(id);
  if (id === null || stood === undefined) return [];
  const rings: DrawnRing[] = [];
  const circle = movementCircle(demo, id);
  const push = pushCircle(demo, id);
  if (circle !== null) rings.push({ at: circle.anchor, radius: circle.radius, kind: 'move' });
  if (push !== null && demo.encounter!.canAct(id)) rings.push({ at: push.anchor, radius: push.radius, kind: 'push' });
  const character = demo.characters.get(id);
  if (jumping && character !== undefined) rings.push({ at: stood.at, radius: jumpRange(jumpRulesFor(demo.project), character.traits), kind: 'jump' });
  return rings;
}
