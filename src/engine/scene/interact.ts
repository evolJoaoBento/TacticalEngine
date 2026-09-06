/**
 * Using an interactable: the verb that was missing.
 *
 * The document has described chests, doors and statues since the legacy import
 * landed — with a key requirement, locked text, a destination, an action roll and
 * effects per outcome — and nothing ever ran any of it. Objects were placed,
 * drawn, and blocked movement. This is the piece that turns that authored data
 * into play.
 *
 * It resolves the parts that need no roll (already used, needs a key you lack,
 * plain travel) and otherwise hands the check to `ScriptRunner`, which pauses for
 * the roll exactly as it does anywhere else. Nothing here rolls dice or mutates
 * state directly — that all belongs to the runner and the world, so a use is as
 * replayable from a seed as a fight is.
 */

import type { Rng } from '../core/rng';
import { ScriptRunner, type JournalEntry, type Prompt } from '../script/runner';
import type { ScriptWorld } from '../script/runner';
import type { Effect, Interactable } from './schema';

/** Why a use did nothing. */
export type RefusalReason = 'alreadyUsed' | 'removed' | 'locked' | 'nothingToDo';

export type UseResult =
  /** It did something, and finished. */
  | { status: 'done'; journal: readonly JournalEntry[]; runner: ScriptRunner }
  /** It needs an answer — a roll, or a choice — before it can finish. */
  | { status: 'waiting'; prompt: Prompt; journal: readonly JournalEntry[]; runner: ScriptRunner }
  /** It refused, with a line to show for it. */
  | { status: 'refused'; reason: RefusalReason; text: string };

export interface UseOptions {
  /**
   * Let a thing be used more than once. Doors and levers want this; a chest with
   * one set of loot in it does not, which is what `markUsed` records.
   */
  repeatable?: boolean;
}

/**
 * Use an interactable.
 *
 * The order matters and follows the legacy prototype
 * (`docs/research/legacy-campaign.md` §6): a removed thing is gone, a used thing
 * stays used, a locked thing reports its locked text without spending the roll,
 * and only then does the check run.
 */
export function useInteractable(
  interactable: Interactable,
  world: ScriptWorld,
  rng: Rng,
  options: UseOptions = {},
): UseResult {
  const state = world.interactableState(interactable.id);

  if (state.removed) {
    return { status: 'refused', reason: 'removed', text: 'There is nothing there any more.' };
  }
  if (state.used && options.repeatable !== true) {
    return { status: 'refused', reason: 'alreadyUsed', text: 'You have already dealt with this.' };
  }
  if (interactable.requiresKey !== undefined && !world.hasKey(interactable.requiresKey)) {
    return {
      status: 'refused',
      reason: 'locked',
      // Authored text if there is any, because "Locked." is the author's line to
      // write, not the engine's.
      text: interactable.lockedText !== '' ? interactable.lockedText : 'It is locked.',
    };
  }

  const effects = openingEffects(interactable);
  if (effects.length === 0) {
    return { status: 'refused', reason: 'nothingToDo', text: describe(interactable) };
  }

  // Bare `open`/`markUsed` in an authored outcome mean this object.
  const runner = new ScriptRunner(world, rng, { subject: interactable.id });
  const result = runner.run(effects);
  if (result.status === 'waiting') {
    return { status: 'waiting', prompt: result.prompt, journal: result.journal, runner };
  }
  return { status: 'done', journal: result.journal, runner };
}

/**
 * What using this thing runs.
 *
 * A check is the interesting case; `goto` is travel with no roll. Either marks
 * the thing used, so a chest does not pay out twice. Flavour on its own does
 * not: reading an inscription should not consume it.
 */
function openingEffects(interactable: Interactable): Effect[] {
  const effects: Effect[] = [];
  if (interactable.flavor !== '') {
    effects.push({ kind: 'log', text: interactable.flavor, tone: 'narration' });
  }
  if (interactable.check !== undefined) {
    effects.push({ kind: 'check', check: interactable.check });
  } else if (interactable.goto !== undefined) {
    effects.push({ kind: 'goto', scene: interactable.goto });
  } else {
    return effects;
  }
  effects.push({ kind: 'markUsed', interactable: interactable.id });
  return effects;
}

/** The line shown for a thing that does nothing at all. */
function describe(interactable: Interactable): string {
  if (interactable.flavor !== '') return interactable.flavor;
  if (interactable.name !== '') return `${interactable.name}. Nothing happens.`;
  return 'Nothing happens.';
}
