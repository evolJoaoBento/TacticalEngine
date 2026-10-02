/**
 * How the game stands, as a replica is told it (`docs/SERVER.md`, phase 3; the Rust is `game/replica.rs`).
 *
 * A replica is the engine built to WebAssembly, in the page, answering what the pointer asks on every move -
 * the ground a walk reaches, the line a click would walk, where a push or a jump goes, where a card may be
 * aimed and whom it would catch - while the game is played somewhere else: here today, on the server once
 * phase 3 is done. It is stood up from the same project and then sent this after every intent: the room and
 * its state, the scenario, the sheets, the party's control, the fight and the GM turn's spotlights, and
 * whether a question is open. A script paused on a question has no form to send; the replica only has to
 * know that one waits.
 */

import type { CharacterSheet } from '../engine/character/sheet';
import type { EncounterSnapshot } from '../engine/combat/encounter';
import type { PartySnapshot } from '../engine/scene/party';
import type { SceneStateSnapshot } from '../engine/scene/state';
import { scenarioSnapshot, type ScenarioSnapshot } from '../engine/script/world';
import type { DemoScene } from './demo-scene';

export interface Replica {
  sceneId: string;
  state: SceneStateSnapshot;
  /** The rooms already left, as they were left - a chest emptied, a door opened - in the order first left. */
  rooms: [string, SceneStateSnapshot][];
  scenario: ScenarioSnapshot;
  sheets: CharacterSheet[];
  party: PartySnapshot;
  encounter: EncounterSnapshot | null;
  /** How many times each creature has been spotlighted this GM turn, in id order; none between turns. */
  spotlights: [string, number][];
  questionOpen: boolean;
}

/** How the game stands, as a replica is told it (`replica_snapshot`). */
export function replicaOf(demo: DemoScene): Replica {
  const spotlights = Object.entries(demo.gmTurn?.spotlights ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    sceneId: demo.scene.id,
    state: demo.state.snapshot(),
    rooms: [...demo.snapshots.entries()],
    scenario: scenarioSnapshot(demo.scenario),
    sheets: [...demo.sheets.values()],
    party: demo.party.snapshot(),
    encounter: demo.encounter?.snapshot() ?? null,
    spotlights,
    questionOpen: demo.pending !== null,
  };
}
