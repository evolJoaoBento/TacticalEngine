/**
 * The moves a roll stands in front of: a run under pressure, and a jump.
 *
 * Both are a click on the ground that `moveSelectedTo` hands over rather than walks, both ask
 * for an Agility Roll as a script - so the dice, the Light and Shadow, the spotlight and the
 * prompt are the ones every other roll in the game gets - and both do their walking when the
 * answer comes back. Apart from `demo-scene.ts` because that file is at its limit, and because
 * two of them is where they stopped being the tail of a click and became a kind of thing.
 */

import type { Spot } from '../engine/grid/grid';
import { jumpRulesFor } from './demo-rules';
import { type DemoScene } from './demo-scene';
import { jumpArc, leapTargets, planRunningJump, type JumpArc } from './leap';
import { nameOf, note } from './log';
import { inCombat } from './moment';

/** What the Jump button arms the bar with: the id the board's aiming reads, which no card can have. */
export const JUMP_ID = 'jump:button';

/** Whether the selected member may be offered a jump at all: somebody who can act, in a project that has jumping. */
export function jumpOffered(demo: DemoScene): boolean {
  const id = demo.party.selected;
  if (id === null || !demo.party.canCommand(id) || !jumpRulesFor(demo.project).enabled) return false;
  return !inCombat(demo) || demo.encounter!.canAct(id);
}

/**
 * Arm a jump: the landings to light, as the bar's aiming holds a card's. Null, with a line in
 * the log saying why, when there is nowhere to jump to from anywhere this move reaches.
 */
export function jumpAim(demo: DemoScene): { characterId: string; abilityId: string; name: string; valid: string[]; tiles: number[] } | null {
  const id = demo.party.selected;
  if (id === null || demo.pending !== null || demo.ambush !== null || !jumpOffered(demo)) return null;
  const tiles = leapTargets(demo, id);
  if (tiles.length > 0) return { characterId: id, abilityId: JUMP_ID, name: 'Jump', valid: [], tiles };
  note(demo, `${nameOf(demo, id)} has nowhere to jump to from here.`, 'system');
  return null;
}

/** Whether a jump aimed at a tile is one that can be made, walk and all: what a click there is allowed to be. */
export function jumpReaches(demo: DemoScene, id: string, destination: number, aim?: Spot): boolean {
  return planRunningJump(demo, id, destination, aim) !== null;
}

/** The arc to draw while the bar is armed with a jump and the pointer is over a tile; null for anything else. */
export function aimedArc(demo: DemoScene, armed: { abilityId: string; characterId: string; aimed?: number; aimedAt?: Spot } | null): JumpArc | null {
  return armed === null || armed.abilityId !== JUMP_ID || armed.aimed === undefined ? null : jumpArc(demo, armed.characterId, armed.aimed, armed.aimedAt);
}
