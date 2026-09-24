/**
 * What a script's journal means to the countdowns on the board. Out of `demo-scene.ts`, which has
 * no room left to grow.
 */

import type { CountdownCue } from '../engine/rules/countdown';
import type { JournalEntry } from '../engine/script/runner';
import type { DemoScene } from './demo-scene';

/**
 * What a script did that a countdown might be waiting for: a party member's
 * action roll, and any Hit Points anyone marked.
 *
 * A check is rolled by whoever the script is acting as, so it counts as the
 * party's only when the party is acting; an attack names its own roller. Hit
 * Points are nobody's side - "when they mark HP, tick down this countdown by
 * the number of HP marked" is written about the countdown's owner, and the
 * board only hands the cue to the countdown whose owner marked them.
 */
export function cuesFrom(demo: Pick<DemoScene, 'state' | 'scenario'>, journal: readonly JournalEntry[]): CountdownCue[] {
  const isParty = (id: string | null): boolean =>
    id !== null && demo.state.entity(id)?.faction === 'party';
  const cues: CountdownCue[] = [];
  for (const entry of journal) {
    if (entry.kind === 'check' && isParty(demo.scenario.actorId)) {
      cues.push({ kind: 'actionRoll', attack: false, outcome: entry.roll.outcome });
    }
    if (entry.kind === 'attack') {
      if (entry.roll !== undefined && isParty(entry.attacker)) {
        cues.push({ kind: 'actionRoll', attack: true, outcome: entry.roll.outcome });
      }
      if (entry.hitPointsMarked > 0) {
        cues.push({ kind: 'hpMarked', id: entry.target, marked: entry.hitPointsMarked });
      }
    }
  }
  return cues;
}
