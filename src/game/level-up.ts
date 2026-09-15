/**
 * Taking a level between fights.
 *
 * The rule is `levelUp` in the engine; this is the game's side of it — which
 * sheet, whether now is a moment it can happen, and what changes on the board
 * once it has. Nothing in `demo-scene.ts` calls back into here.
 */

import { levelUp, type LevelUpIssue, type LevelUpPlan } from '../engine/character/progression';
import { inCombat, refreshWorld, setSheet, type DemoScene, type SheetChange } from './demo-scene';
import { characterContentFor } from './room';
import { note } from './log';

/** Party members whose sheet is below the level the party has been granted. */
export function awaitingLevel(demo: Pick<DemoScene, 'sheets' | 'scenario'>): string[] {
  return [...demo.sheets.values()].filter((s) => s.level < demo.scenario.partyLevel).map((s) => s.id);
}

export type LevelUpResult = { ok: true; level: number } | { ok: false; issues: LevelUpIssue[] };

/**
 * Take a level for one character.
 *
 * The plan is checked whole by `levelUp`; if it holds, the sheet is replaced,
 * the derived character rebuilt, and the live entity's pools grow to match —
 * the new slots arrive unmarked, and nothing marked is cleared. Refused during
 * a fight or a pending prompt, because the script world caches the party's
 * traits and a fresh one would orphan whatever is waiting.
 */
export function applyLevelUp(demo: SheetChange, characterId: string, plan: LevelUpPlan): LevelUpResult {
  const sheet = demo.sheets.get(characterId);
  if (sheet === undefined) return { ok: false, issues: [{ field: 'character', message: `no character "${characterId}"` }] };
  if (sheet.level >= demo.scenario.partyLevel) {
    return { ok: false, issues: [{ field: 'level', message: 'no level-up waiting' }] };
  }
  if (inCombat(demo) || demo.pending !== null) {
    return { ok: false, issues: [{ field: 'level', message: 'not in the middle of a fight or a conversation' }] };
  }

  const result = levelUp(sheet, characterContentFor(demo.project), plan);
  if (result.issues.length > 0) return { ok: false, issues: result.issues };

  setSheet(demo, result.sheet);
  const derived = demo.characters.get(characterId)!;

  const entity = demo.state.entity(characterId);
  if (entity !== undefined) {
    entity.hitPoints = { max: derived.hitPoints, marked: Math.min(entity.hitPoints.marked, derived.hitPoints) };
    entity.stress = { max: derived.stress, marked: Math.min(entity.stress.marked, derived.stress) };
    entity.armorSlots = { max: derived.armorScore, marked: Math.min(entity.armorSlots.marked, derived.armorScore) };
  }

  // The script world caches the party's best traits; a raised Strength has to
  // reach the next check.
  refreshWorld(demo);
  note(demo, `${result.sheet.name} reaches level ${result.sheet.level}.`, 'good');
  return { ok: true, level: result.sheet.level };
}
