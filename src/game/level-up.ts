/**
 * Taking a level between fights.
 *
 * The rule is `levelUp` in the engine; this is the game's side of it — which
 * sheet, whether now is a moment it can happen, and what changes on the board
 * once it has. Nothing in `demo-scene.ts` calls back into here.
 */

import { type LevelUpIssue } from '../engine/character/progression';
import { type DemoScene } from './demo-scene';

/** Party members whose sheet is below the level the party has been granted. */
export function awaitingLevel(demo: Pick<DemoScene, 'sheets' | 'scenario'>): string[] {
  return [...demo.sheets.values()].filter((s) => s.level < demo.scenario.partyLevel).map((s) => s.id);
}

export type LevelUpResult = { ok: true; level: number } | { ok: false; issues: LevelUpIssue[] };
