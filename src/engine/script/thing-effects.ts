/**
 * The effects that act on a thing in a room: open it, shut it, flip it, use it up, take it away,
 * show what it holds, or leave by it.
 *
 * `open`, `remove` and `markUsed` are as old as objects. `close`, `toggleOpen`, `openContainer`
 * and `teleport` came with prop functions (`scene/prop-functions.ts`), which are built out of these
 * and of every other effect there is - so a new function is a new arrangement of parts that
 * already exist, and every one of those parts is usable from any script: a card can open a door,
 * a dialogue reply can show a chest's contents.
 *
 * Kept out of `runner.ts`, which is pinned at its size: the runner hands all seven over in one
 * line and this does the rest.
 *
 * What a container shows and where a portal leads are the game's to act on, the way `goto` and
 * `startDialogue` are. The runner journals them, and the caller - which has a screen and a map -
 * acts once the script has finished.
 */

import type { Effect } from './schema';
import type { JournalEntry, ScriptWorld } from './runner';

type ThingEffect = Extract<Effect, { kind: 'open' | 'close' | 'toggleOpen' | 'remove' | 'markUsed' | 'openContainer' | 'teleport' }>;

type ThingWorld = Pick<ScriptWorld, 'interactableState' | 'openInteractable' | 'closeInteractable' | 'removeInteractable' | 'markInteractableUsed'>;

export function applyThingEffect(effect: ThingEffect, world: ThingWorld, journal: JournalEntry[], subject: string | null | undefined): null {
  if (effect.kind === 'teleport') {
    journal.push({ kind: 'teleport', pair: effect.pair, from: subject ?? null });
    return null;
  }
  // An effect with no id means whatever the script was started from; a caller with no such subject
  // gets nothing rather than a crash.
  const id = effect.interactable ?? subject;
  if (id === null || id === undefined) return null;
  switch (effect.kind) {
    case 'openContainer':
      journal.push({ kind: 'openContainer', id });
      return null;
    case 'remove':
      world.removeInteractable(id);
      journal.push({ kind: 'interactable', id, change: 'removed' });
      return null;
    case 'markUsed':
      world.markInteractableUsed(id);
      journal.push({ kind: 'interactable', id, change: 'used' });
      return null;
  }
  const opening = effect.kind === 'open' || (effect.kind === 'toggleOpen' && !world.interactableState(id).open);
  if (opening) {
    world.openInteractable(id);
    journal.push({ kind: 'interactable', id, change: 'open' });
    return null;
  }
  world.closeInteractable(id);
  // It will not shut on somebody standing in it, and says so rather than claiming it did.
  if (world.interactableState(id).open) journal.push({ kind: 'log', text: 'It will not shut with somebody in the way.', tone: 'system' });
  else journal.push({ kind: 'interactable', id, change: 'closed' });
  return null;
}
