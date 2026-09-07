/**
 * Countdowns (SRD 2.0, "Countdowns").
 *
 * "Countdowns represent a period of time or series of events preceding a
 * future effect. A countdown begins at a starting value. When a countdown
 * advances, it's reduced by 1. The countdown's effect is triggered when the
 * countdown reaches 0."
 *
 * This module is the clock and nothing else: it holds no effects, names no
 * creature and rolls no dice, so a starting value written as `1d6` is rolled
 * by whoever owns the rng and handed here as a number. What a countdown does
 * when it triggers belongs to the script layer.
 *
 * Rule text quoted from SRD 2.0, `tools/srd-sources/official-2.0/srd-2.0.txt`.
 */

import type { RollOutcome } from './duality';

/**
 * What makes a countdown advance.
 *
 * `standard` is the SRD's default — "Standard countdowns advance every time a
 * player makes an action roll". The next three are the triggers printed on
 * stat blocks: "it ticks down when a PC makes an attack roll", "when a PC
 * rolls with Fear", "when they mark HP, tick down this countdown by the
 * number of HP marked". The last two are the dynamic countdowns, which
 * advance by up to 3 on the outcome of the roll rather than by 1.
 */
export const COUNTDOWN_ADVANCES = ['standard', 'attackRoll', 'withFear', 'hpMarked', 'progress', 'consequence'] as const;

export type CountdownAdvance = (typeof COUNTDOWN_ADVANCES)[number];

/**
 * What happens when a countdown triggers.
 *
 * Absent: it is spent and gone. `reset`: "Loop countdowns that reset to their
 * starting value after their countdown effect is triggered." `increasing` and
 * `decreasing` are loops whose starting value moves by 1 each time.
 */
export const COUNTDOWN_LOOPS = ['reset', 'increasing', 'decreasing'] as const;

export type CountdownLoop = (typeof COUNTDOWN_LOOPS)[number];

/** A countdown's clock: where it is, where it starts, and how it loops. */
export interface CountdownClock {
  value: number;
  start: number;
  loop?: CountdownLoop;
}

/** What a tick did to a clock. `clock` is `null` when the countdown is over. */
export interface CountdownTick {
  clock: CountdownClock | null;
  /** The value it reached, before any loop reset it: 0 when it triggered. */
  value: number;
  fired: boolean;
}

/** Something that happened at the table which a countdown might answer. */
export type CountdownCue =
  | {
      kind: 'actionRoll';
      /** Whether the roll was an attack roll, for "when a PC makes an attack roll". */
      attack: boolean;
      outcome: RollOutcome;
    }
  /** A creature marked Hit Points: `id` is the one that marked them. */
  | { kind: 'hpMarked'; id: string; marked: number };

/**
 * "Dynamic countdowns advance by up to 3 depending on the outcomes of action
 * rolls", by the SRD's DYNAMIC COUNTDOWN ADVANCEMENT chart. Progress
 * countdowns run towards something the party wants and so are moved by their
 * successes; consequence countdowns run towards something they do not want
 * and are moved by their failures. A roll that does neither advances nothing.
 */
export function dynamicSteps(kind: 'progress' | 'consequence', outcome: RollOutcome): number {
  if (kind === 'progress') {
    switch (outcome) {
      case 'criticalSuccess':
        return 3;
      case 'successWithHope':
        return 2;
      case 'successWithFear':
        return 1;
      default:
        return 0;
    }
  }
  switch (outcome) {
    case 'failureWithFear':
      return 3;
    case 'failureWithHope':
      return 2;
    case 'successWithFear':
      return 1;
    default:
      return 0;
  }
}

/** Whether an outcome was rolled with Fear. A critical "counts as a roll with Hope". */
function withFear(outcome: RollOutcome): boolean {
  return outcome === 'successWithFear' || outcome === 'failureWithFear';
}

/**
 * How far this cue moves a countdown that advances by this rule — 0 when the
 * cue is not the one it is waiting for.
 *
 * `hpMarked` is the only rule that answers something other than a roll, and it
 * advances "by the number of HP marked" rather than by 1. Whether the creature
 * that marked them is the one whose countdown this is has to be settled by the
 * caller, which is the only one that knows who owns what.
 */
export function stepsFor(advance: CountdownAdvance, cue: CountdownCue): number {
  if (cue.kind === 'hpMarked') return advance === 'hpMarked' ? Math.max(0, cue.marked) : 0;
  switch (advance) {
    case 'standard':
      return 1;
    case 'attackRoll':
      return cue.attack ? 1 : 0;
    case 'withFear':
      return withFear(cue.outcome) ? 1 : 0;
    case 'progress':
    case 'consequence':
      return dynamicSteps(advance, cue.outcome);
    case 'hpMarked':
      return 0;
  }
}

/**
 * Advance a clock and say what became of it.
 *
 * A countdown that reaches 0 triggers. Without a loop it is spent; with one it
 * comes back at its starting value, which an increasing or decreasing loop
 * moves by 1 first. A decreasing loop that runs its starting value down to 0
 * is over — the Realm-Breaker's "if the countdown ever decreases its maximum
 * value to 0" then reads on the countdown ending, and what that does to the
 * fight is a separate feature nothing here fires.
 *
 * A countdown whose starting value was rolled is re-rolled by the caller: this
 * hands back the value it last started at, and the caller replaces it if the
 * feature wrote its start as dice.
 */
export function advanceCountdown(clock: CountdownClock, steps = 1): CountdownTick {
  const value = Math.max(0, clock.value - Math.max(0, Math.trunc(steps)));
  if (value > 0) return { clock: { ...clock, value }, value, fired: false };
  if (clock.loop === undefined) return { clock: null, value, fired: true };
  const start =
    clock.loop === 'increasing' ? clock.start + 1 : clock.loop === 'decreasing' ? clock.start - 1 : clock.start;
  if (start <= 0) return { clock: null, value, fired: true };
  return { clock: { ...clock, start, value: start }, value, fired: true };
}
