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
import { refreshWorld, setSheet, type DemoScene, type Pending } from './demo-scene';
import { showRoll, type LogLine } from './log';
import { closeContainer, openContainer, showContainer } from './prop-use';
import { replicaOf, type Replica } from './replica';
import { enterSavedScene } from './room';
import { asideFrom, talkingAside } from './talks';

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

/** A question as a board gives it (`pendingOf`, `board.ts`; `board_pending` in the Rust). */
interface Projected {
  kind: Pending['kind'];
  prompt: unknown;
  interactable?: string | null;
  with?: string | null;
  dialogue?: { id: string; view: { node: string; options: unknown[] } | null; prompt: unknown; by: string | null } | null;
}

/**
 * A question the server's game holds, as the page's views read one: its kind and prompt, and for a script the
 * thing it came from, whom it is with, and the conversation on screen - its node and lines found in the
 * page's own project, its options as the server gave them. No runner: the page does not play the answer.
 */
export function shownFrom(demo: DemoScene, projected: Projected): Pending {
  if (projected.kind !== 'script') return { kind: projected.kind, prompt: projected.prompt } as unknown as Pending;
  const d = projected.dialogue ?? null;
  const node = d?.view === null || d === null ? undefined : demo.dialogues.get(d.id)?.nodes.find((n) => n.id === d.view!.node);
  const dialogue =
    d === null
      ? null
      : { id: d.id, view: node === undefined || d.view === null ? null : { node, lines: node.lines, options: d.view.options }, prompt: d.prompt, ...(d.by === null ? {} : { by: d.by }) };
  return {
    kind: 'script',
    prompt: projected.prompt,
    interactable: projected.interactable ?? null,
    ...(projected.with === null || projected.with === undefined ? {} : { with: projected.with }),
    dialogue,
  } as unknown as Pending;
}

/**
 * Stand the page's game where a board says the game stands (`WasmGame`, the wire): the scenario and the sheets,
 * the room entered as it was left and the rooms left before it, the party's control, the fight, the dice, the
 * walk's fight and errand, the open container, the log and the dice to be shown - and the question open and the
 * conversations set aside, as the page's views read them: the question shown from the board (`shownFrom`), each
 * conversation set aside known by who is having it (`asideFrom`). The scripts paused in them are not given back
 * - a board carries none - so the page's game cannot play them on; the game whose board it is plays them.
 */
export function restoreFromBoard(demo: DemoScene, board: BoardSnapshot): void {
  const { replica } = board;
  restoreScenario(demo.scenario, replica.scenario);
  for (const sheet of replica.sheets) setSheet(demo, sheet);
  // The same room: its state put back in place, on the ground the page holds - which the editor may have
  // changed under it (`takeGround`) and no snapshot carries. Another room: entered as the board's game left it.
  if (demo.scene.id === replica.sceneId) demo.state.restore(replica.state);
  else enterSavedScene(demo, replica.sceneId, replica.state);
  // The rooms already left, as the board's game left them: travel back to one and it is that room.
  demo.snapshots.clear();
  for (const [id, room] of replica.rooms) demo.snapshots.set(id, room);
  demo.party.restore(replica.party);
  demo.pending = board.pending === null ? null : shownFrom(demo, board.pending as Projected);
  asideFrom(demo, board.aside);
  demo.encounter = replica.encounter === null ? null : EncounterRunner.restore(demo.state, replica.encounter);
  // The GM's turn, as far as a board says: who has been spotlighted this turn, if it is under way. The rest of it
  // - who is still to act - is the game's whose board it is, which plays the turn on.
  demo.gmTurn = replica.spotlights.length === 0 ? null : { remaining: [], acted: 0, spotlights: Object.fromEntries(replica.spotlights), features: {}, granted: new Set(), halved: new Set() };
  demo.rng.restore(board.rng);
  demo.ambush = board.ambush;
  demo.approaching = board.approaching;
  if (board.opened === null) closeContainer(demo);
  else showContainer(demo, board.opened);
  demo.log.length = 0;
  demo.log.push(...board.log.map((line) => ({ ...line })));
  demo.rolls.length = 0;
  for (const { who, what, roll } of board.rolls) showRoll(demo, who, what, roll);
  // The world rebuilt over the state. Its pools are the board's - the game whose board it is derived them - and
  // are not derived here again.
  refreshWorld(demo);
}
