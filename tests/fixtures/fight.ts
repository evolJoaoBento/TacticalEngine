/**
 * A fight begun on the page's model, for a test that needs one standing: the engine core's golden writers
 * (`src/engine/script/runner.golden.test.ts`, `hooks.golden.test.ts`), whose fixtures the Rust is held to,
 * and the queries' tests that ask what a fight changes (the circle, the steer). The game's own beginning of a
 * fight is the engine's (`startEncounter`, `server/engine/src/game`); this is what the page's game did, kept
 * word for word so the fixtures written over it stay what they were.
 */

import { EncounterRunner } from '../../src/engine/combat/encounter';
import type { DemoScene } from '../../src/game/demo-scene';

/** The fight `encounterId` begun: the same one still going kept, one that has ended begun afresh. */
export function startEncounter(demo: Pick<DemoScene, 'state' | 'encounter'>, encounterId: string): EncounterRunner {
  if (demo.encounter !== null && demo.encounter.encounterId === encounterId && demo.encounter.outcome === 'ongoing') return demo.encounter;
  // Whoever an End a fight stood down is hostile again the moment one begins.
  for (const creature of demo.state.allEntities()) {
    if (creature.truce !== true) continue;
    delete creature.truce;
    demo.state.setAttitude(creature.id, 'hostile');
  }
  const runner = new EncounterRunner(demo.state, encounterId);
  runner.start();
  demo.encounter = runner;
  return runner;
}
