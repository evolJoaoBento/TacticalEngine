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

import type { Condition, ScriptValue } from './conditions';
import type { Trait } from '../scene/schema';

/** Log styling the legacy UI used, kept because the narrative pane depends on it. */
export type LogTone = 'narration' | 'system' | 'hope' | 'fear' | 'combat' | 'success';

export interface ChoiceOption {
  /** What the button says. */
  label: string;
  /** Optional second line explaining the cost or consequence. */
  detail?: string;
  /** Hidden entirely when this fails, so a branch can be gated. */
  available?: Condition;
  effects: readonly Effect[];
}

export type Effect =
  | { kind: 'none' }
  /** A line in the narrative log. */
  | { kind: 'log'; text: string; tone?: LogTone }
  /** A full-screen story panel: title, paragraphs, one button. */
  | { kind: 'story'; title: string; paragraphs: readonly string[]; button?: string }
  | { kind: 'setFlag'; flag: string }
  | { kind: 'clearFlag'; flag: string }
  | { kind: 'giveKey'; key: string }
  | { kind: 'setVar'; name: string; value: ScriptValue }
  /** Add to a numeric variable. Treats an unset variable as 0. */
  | { kind: 'addVar'; name: string; by: number }
  | { kind: 'open'; interactable?: string }
  | { kind: 'remove'; interactable?: string }
  | { kind: 'markUsed'; interactable?: string }
  | { kind: 'loot'; table?: string }
  /** Damage that bypasses the attack roll — a trap, a hidden thorn, a puppet strike. */
  | { kind: 'damage'; amount: number; target?: TargetSelector; source?: string }
  | { kind: 'heal'; amount: number; target?: TargetSelector }
  | { kind: 'startEncounter'; encounter: string; intro?: string }
  | { kind: 'endEncounter'; encounter: string }
  | { kind: 'goto'; scene: string }
  | { kind: 'startDialogue'; dialogue: string }
  /** Run one branch of an effect list, chosen by condition. */
  | { kind: 'branch'; when: Condition; then: readonly Effect[]; otherwise?: readonly Effect[] }
  /** Stop and ask the player to choose. */
  | { kind: 'choice'; title?: string; body?: string; options: readonly ChoiceOption[] }
  /** Stop and ask the player to make an action roll, then dispatch on the outcome. */
  | { kind: 'check'; check: CheckRequest };

/** Who an effect applies to. Kept small; expressions come later if content needs them. */
export type TargetSelector =
  | { kind: 'actor' }
  | { kind: 'party' }
  | { kind: 'entity'; id: string };

export interface CheckRequest {
  trait: Trait;
  difficulty: number;
  /** Shown while the player decides whether to roll. */
  prompt?: string;
  /** Effects per outcome. A missing outcome falls back as `outcomeEffects` describes. */
  onCriticalSuccess?: readonly Effect[];
  onSuccessWithHope?: readonly Effect[];
  onSuccessWithFear?: readonly Effect[];
  onFailureWithHope?: readonly Effect[];
  onFailureWithFear?: readonly Effect[];
  /** Run whichever way it went, after the outcome branch. */
  always?: readonly Effect[];
}

/** Outcomes in the order the duality roll produces them. */
export type CheckOutcome =
  | 'criticalSuccess'
  | 'successWithHope'
  | 'successWithFear'
  | 'failureWithHope'
  | 'failureWithFear';

/**
 * The effects a check outcome runs, with fallbacks.
 *
 * Content rarely writes all five. A critical success falls back to a success with
 * Hope, and either half of a success or failure falls back to the other, so
 * writing two lists gets sensible behaviour for all five outcomes.
 */
export function outcomeEffects(check: CheckRequest, outcome: CheckOutcome): readonly Effect[] {
  const {
    onCriticalSuccess,
    onSuccessWithHope,
    onSuccessWithFear,
    onFailureWithHope,
    onFailureWithFear,
  } = check;
  switch (outcome) {
    case 'criticalSuccess':
      return onCriticalSuccess ?? onSuccessWithHope ?? onSuccessWithFear ?? [];
    case 'successWithHope':
      return onSuccessWithHope ?? onSuccessWithFear ?? [];
    case 'successWithFear':
      return onSuccessWithFear ?? onSuccessWithHope ?? [];
    case 'failureWithHope':
      return onFailureWithHope ?? onFailureWithFear ?? [];
    case 'failureWithFear':
      return onFailureWithFear ?? onFailureWithHope ?? [];
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
