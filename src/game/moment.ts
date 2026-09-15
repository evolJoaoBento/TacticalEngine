/**
 * Where the game is: whether a fight is running, and whether a script has
 * stopped to ask the player something. Two questions everything asks — the
 * fight, a walk, a level taken, an item used — so they live below all of them,
 * and each reads one field.
 */

import type { DemoScene, PendingScript } from './demo-scene';

/** Whether a fight is currently running. */
export function inCombat(demo: Pick<DemoScene, 'encounter'>): boolean {
  return demo.encounter !== null && demo.encounter.outcome === 'ongoing';
}

/** The waiting script, when what is waiting is a script and not a defender. */
export function scriptPending(demo: Pick<DemoScene, 'pending'>): PendingScript | null {
  return demo.pending !== null && demo.pending.kind === 'script' ? demo.pending : null;
}
