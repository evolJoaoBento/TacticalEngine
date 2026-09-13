/**
 * Effects: the things content can make happen.
 *
 * This is the legacy prototype's effect vocabulary, generalised and typed
 * (docs/research/legacy-campaign.md §6). Everything a scenario does — opening a
 * door, setting a flag, starting a fight, showing a line of narration, asking the
 * player to pick a branch, rolling a check — is an entry in this union.
 *
 * Two effects are different in kind from the rest: `choice` and `check` need an
 * answer before the script can continue. They are not async, and they do not call
 * back into a UI. `runner.ts` stops on them and hands the caller a prompt, which
 * is what keeps this whole layer testable in node and replayable from a seed.
 */

import type { Condition } from './conditions';

/**
 * The shapes live in `schema.ts` so a document can hold them; this module keeps
 * the behaviour that reads them. Re-exported so existing importers are unchanged.
 */
export type {
  Effect,
  ChoiceOption,
  TargetSelector,
  CheckRequest,
  LogTone,
} from './schema';
export { effectSchema, checkRequestSchema, walkEffects, walkCheck } from './schema';

import type { CheckRequest, Effect, LogTone, ScriptValue } from './schema';

/** Outcomes in the order the duality roll produces them. */
export type CheckOutcome =
  | 'criticalSuccess'
  | 'successWithGood'
  | 'successWithBad'
  | 'failureWithGood'
  | 'failureWithBad';

/**
 * The effects a check outcome runs, with fallbacks.
 *
 * Content rarely writes all five. A critical success falls back to a success with
 * Light, and either half of a success or failure falls back to the other, so
 * writing two lists gets sensible behaviour for all five outcomes.
 */
export function outcomeEffects(check: CheckRequest, outcome: CheckOutcome): readonly Effect[] {
  const {
    onCriticalSuccess,
    onSuccessWithGood,
    onSuccessWithBad,
    onFailureWithGood,
    onFailureWithBad,
  } = check;
  switch (outcome) {
    case 'criticalSuccess':
      return onCriticalSuccess ?? onSuccessWithGood ?? onSuccessWithBad ?? [];
    case 'successWithGood':
      return onSuccessWithGood ?? onSuccessWithBad ?? [];
    case 'successWithBad':
      return onSuccessWithBad ?? onSuccessWithGood ?? [];
    case 'failureWithGood':
      return onFailureWithGood ?? onFailureWithBad ?? [];
    case 'failureWithBad':
      return onFailureWithBad ?? onFailureWithGood ?? [];
  }
}

// ---------------------------------------------------------------------------
// Constructors, for content written in TypeScript.
// ---------------------------------------------------------------------------

export const log = (text: string, tone: LogTone = 'narration'): Effect => ({ kind: 'log', text, tone });
export const setFlag = (flag: string): Effect => ({ kind: 'setFlag', flag });
export const giveKey = (key: string): Effect => ({ kind: 'giveKey', key });
export const setVar = (name: string, value: ScriptValue): Effect => ({ kind: 'setVar', name, value });
export const addVar = (name: string, by: number): Effect => ({ kind: 'addVar', name, by });
export const goto = (scene: string): Effect => ({ kind: 'goto', scene });
export const startEncounter = (encounter: string, intro?: string): Effect =>
  intro === undefined
    ? { kind: 'startEncounter', encounter }
    : { kind: 'startEncounter', encounter, intro };
