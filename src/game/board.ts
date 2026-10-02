/**
 * The board (`docs/SERVER.md`, phase 3, slice 3b; the Rust is `game/board.rs`): how the game stands, as the
 * page reads it and as a game played elsewhere is compared with it - the replica (`replica.ts`), and what a
 * replica is not told because nothing is answered from it: the fight's view and log, the question open as the
 * panel draws it, the walk's held fight and errand, the log, the container open, the conversations set aside,
 * and where the dice had got to. What a view drains - the motions, the numbers over heads - is not on it:
 * those are taken.
 */

import { EncounterRunner } from '../engine/combat/encounter';
import type { DualityRoll } from '../engine/rules/duality';
import { restoreScenario } from '../engine/script/world';
import { refreshWorld, setSheet, syncPools, type DemoScene } from './demo-scene';
import { showRoll, type LogLine } from './log';
import { closeContainer, openContainer, showContainer } from './prop-use';
import { replicaOf, type Replica } from './replica';
import { enterSavedScene } from './room';
import { talkingAside } from './talks';

/** A board as it is sent: what `boardOf` and `Session::board` write. */
export interface BoardSnapshot {
  replica: Replica;
  fight: unknown;
  pending: unknown;
  ambush: string | null;
  approaching: DemoScene['approaching'];
  log: LogLine[];
  rolls: { who: string; what: string; roll: DualityRoll }[];
  opened: string | null;
  aside: string[];
  rng: number;
}

/** The question open, as the panel draws it (`board_pending`). */
function pendingOf(demo: DemoScene): unknown {
  const pending = demo.pending;
  if (pending === null) return null;
  if (pending.kind !== 'script') return { kind: pending.kind, prompt: pending.prompt };
  const d = pending.dialogue;
  return {
    kind: 'script',
    prompt: pending.prompt,
    interactable: pending.interactable,
    with: pending.with ?? null,
    dialogue: d === null ? null : { id: d.id, view: d.view === null ? null : { node: d.view.node.id, options: d.view.options }, prompt: d.prompt, by: d.by ?? null },
  };
}

/** How the game stands, as the page reads it (`board`). */
/** The dice still to be shown, as the board gives them - and as an engine brought into step is told them. */
export function rollsOf(demo: DemoScene): BoardSnapshot['rolls'] {
  return demo.rolls.map(({ who, what, roll }) => ({ who, what, roll }));
}

export function boardOf(demo: DemoScene): BoardSnapshot {
  return {
    replica: replicaOf(demo),
    fight: demo.encounter === null ? null : { view: demo.encounter.view(), log: demo.encounter.log },
    pending: pendingOf(demo),
    ambush: demo.ambush,
    approaching: demo.approaching,
    log: demo.log,
    rolls: rollsOf(demo),
    opened: openContainer(demo),
    aside: talkingAside(demo),
    rng: demo.rng.save(),
  } as BoardSnapshot;
}

/**
 * Stand the page's game where a board says the game stands (`WasmGame`): the scenario and the sheets, the room
 * entered as it was left, the party's control, the fight, the dice, the walk's fight and errand, the open
 * container, the log and the dice to be shown. What a board cannot give back is a question waiting - a
 * script paused mid-run - or a conversation set aside: those are the engine's to hold, and the page's game
 * is out of step while they last.
 */
export function restoreFromBoard(demo: DemoScene, board: BoardSnapshot): void {
  const { replica } = board;
  restoreScenario(demo.scenario, replica.scenario);
  for (const sheet of replica.sheets) setSheet(demo, sheet);
  enterSavedScene(demo, replica.sceneId, replica.state);
  // The rooms already left, as the board's game left them: travel back to one and it is that room.
  demo.snapshots.clear();
  for (const [id, room] of replica.rooms) demo.snapshots.set(id, room);
  demo.party.restore(replica.party);
  demo.encounter = replica.encounter === null ? null : EncounterRunner.restore(demo.state, replica.encounter);
  demo.rng.restore(board.rng);
  demo.ambush = board.ambush;
  demo.approaching = board.approaching;
  if (board.opened === null) closeContainer(demo);
  else showContainer(demo, board.opened);
  demo.log.length = 0;
  demo.log.push(...board.log.map((line) => ({ ...line })));
  demo.rolls.length = 0;
  for (const { who, what, roll } of board.rolls) showRoll(demo, who, what, roll);
  refreshWorld(demo);
  syncPools(demo);
}
