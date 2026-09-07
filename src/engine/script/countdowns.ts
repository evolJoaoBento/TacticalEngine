/**
 * Countdowns as the fight carries them: the clock from `rules/countdown.ts`,
 * plus who armed it and what it does when it triggers.
 *
 * The board lives on the scenario, which is what a save writes, so a clock
 * survives a defence prompt, a GM turn and a reload. Nothing here decides
 * *when* to advance a countdown — the game layer knows what a player just
 * rolled — and nothing here runs an effect: it hands back the countdowns that
 * reached 0 and the caller plays them, with the one that armed them acting.
 */

import { z } from 'zod';
import { rollDice, parseDice } from '../rules/dice';
import type { Rng } from '../core/rng';
import {
  COUNTDOWN_ADVANCES,
  COUNTDOWN_LOOPS,
  advanceCountdown,
  stepsFor,
  type CountdownCue,
  type CountdownAdvance,
  type CountdownLoop,
} from '../rules/countdown';
import { effectSchema, type Effect } from './schema';

/** A countdown that is running. */
export interface RunningCountdown {
  /** The id the feature gave it: arming it again under this id restarts it. */
  id: string;
  name: string;
  /** The creature counting it, or null for a countdown the scene armed. */
  owner: string | null;
  /** The starting value as written, so a loop can re-roll "Loop 1d6". */
  dice: string;
  value: number;
  start: number;
  advance: CountdownAdvance;
  loop?: CountdownLoop;
  /** What the owner falling does to it: end it, or set it off. */
  onDeath: 'end' | 'trigger';
  effects: readonly Effect[];
}

/** A countdown that moved, as it stood at that moment. */
export interface CountdownMoved {
  countdown: RunningCountdown;
  /** The value it reached, before any loop reset it: 0 when it triggered. */
  value: number;
  fired: boolean;
}

export const runningCountdownSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  owner: z.string().min(1).nullable(),
  dice: z.string().min(1),
  value: z.number().int().min(0),
  start: z.number().int().min(0),
  advance: z.enum(COUNTDOWN_ADVANCES),
  loop: z.enum(COUNTDOWN_LOOPS).optional(),
  onDeath: z.enum(['end', 'trigger']),
  get effects() {
    return z.array(effectSchema).default([]);
  },
});

/** The clocks a scenario is carrying, keyed by countdown id. */
export type CountdownBoard = Map<string, RunningCountdown>;

/** A snapshot of a running countdown, as a save holds it. */
export type CountdownSnapshot = z.infer<typeof runningCountdownSchema>;

/**
 * Advance every countdown this cue speaks to, and hand back the ones that
 * moved — the caller logs them, and plays the effects of the ones that fired.
 *
 * A countdown that triggers is taken off the board unless it loops; one whose
 * starting value was written as dice rolls a fresh one each time it comes back,
 * which is what "Countdown (Loop 1d6)" reads as at the table.
 */
export function advanceBoard(board: CountdownBoard, cue: CountdownCue, rng: Rng): CountdownMoved[] {
  const moved: CountdownMoved[] = [];
  // A snapshot of the ids first: an effect this fires may arm another clock,
  // and a countdown armed by a countdown does not advance on the same cue.
  for (const id of [...board.keys()]) {
    const countdown = board.get(id);
    if (countdown === undefined) continue;
    if (cue.kind === 'hpMarked' && cue.id !== countdown.owner) continue;
    const steps = stepsFor(countdown.advance, cue);
    if (steps === 0) continue;

    const tick = advanceCountdown(countdown, steps);
    moved.push({ countdown: { ...countdown }, value: tick.value, fired: tick.fired });
    if (tick.clock === null) {
      board.delete(id);
      continue;
    }
    const looped = tick.fired ? rolledStart(countdown, tick.clock.start, rng) : tick.clock.start;
    board.set(id, { ...countdown, value: tick.fired ? looped : tick.clock.value, start: looped });
  }
  return moved;
}

/**
 * What a loop comes back at. A countdown written as a number comes back at the
 * number the loop worked out; one written as dice is rolled again, so the
 * party never learns the length of the next one from the last.
 */
function rolledStart(countdown: RunningCountdown, worked: number, rng: Rng): number {
  const expression = parseDice(countdown.dice);
  if (expression === null || expression.count === 0) return worked;
  // An increasing or decreasing loop moves the *starting value*, which a
  // re-rolled countdown does not have to keep; the SRD prints neither
  // together, so the roll wins and the drift is the roll's.
  return Math.max(1, rollDice(rng, expression).total);
}

/** Where a countdown's owner is: standing, down, or not in this room at all. */
export type OwnerStatus = 'alive' | 'fallen' | 'gone';

/**
 * Countdowns whose owner is no longer standing. A countdown ends with the creature
 * counting it — "if the Gorgon is defeated, all petrification countdowns end"
 * — unless its feature says otherwise, in which case it goes off now: the
 * Ashen Tyrant's death throes.
 *
 * `gone` is not `fallen`. A countdown lives on the scenario, which outlives
 * the room it was armed in, so its owner may simply be somewhere else by now:
 * that clock stops, and stops quietly. Death throes are for the dead.
 *
 * Everything leaves the board either way, so this is safe to call after every
 * death and it never fires the same countdown twice.
 */
export function reapBoard(board: CountdownBoard, status: (id: string) => OwnerStatus): CountdownMoved[] {
  const fired: CountdownMoved[] = [];
  for (const [id, countdown] of [...board]) {
    if (countdown.owner === null) continue;
    const where = status(countdown.owner);
    if (where === 'alive') continue;
    board.delete(id);
    if (where === 'fallen' && countdown.onDeath === 'trigger') {
      fired.push({ countdown: { ...countdown }, value: 0, fired: true });
    }
  }
  return fired;
}

/**
 * End every countdown a creature was counting, without setting any of them
 * off: the fight is over, and a clock armed in it has nothing left to count.
 * Countdowns nobody owns are the scene's own, and keep running.
 */
export function endCreatureCountdowns(board: CountdownBoard): void {
  for (const [id, countdown] of [...board]) {
    if (countdown.owner !== null) board.delete(id);
  }
}
