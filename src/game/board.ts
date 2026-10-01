/**
 * The board (`docs/SERVER.md`, phase 3, slice 3b; the Rust is `game/board.rs`): how the game stands, as the
 * page reads it and as a game played elsewhere is compared with it - the replica (`replica.ts`), and what a
 * replica is not told because nothing is answered from it: the fight's view and log, the question open as the
 * panel draws it, the walk's held fight and errand, the log, the container open, the conversations set aside,
 * and where the dice had got to. What a view drains - the motions, the numbers over heads - is not on it:
 * those are taken.
 */

import type { DemoScene } from './demo-scene';
import { openContainer } from './prop-use';
import { replicaOf } from './replica';
import { talkingAside } from './talks';

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
export function boardOf(demo: DemoScene): unknown {
  return {
    replica: replicaOf(demo),
    fight: demo.encounter === null ? null : { view: demo.encounter.view(), log: demo.encounter.log },
    pending: pendingOf(demo),
    ambush: demo.ambush,
    approaching: demo.approaching,
    log: demo.log,
    rolls: demo.rolls.map(({ who, what, roll }) => ({ who, what, roll })),
    opened: openContainer(demo),
    aside: talkingAside(demo),
    rng: demo.rng.save(),
  };
}
