import { describe, it, expect } from 'vitest';
import type { RollOutcome } from './duality';
import { advanceCountdown, dynamicSteps, stepsFor, type CountdownClock } from './countdown';

const OUTCOMES: RollOutcome[] = [
  'criticalSuccess',
  'successWithGood',
  'successWithBad',
  'failureWithGood',
  'failureWithBad',
];

describe('dynamicSteps', () => {
  // The SRD's DYNAMIC COUNTDOWN ADVANCEMENT chart, row for row.
  it('moves a progress countdown on what the party pulls off', () => {
    const steps = OUTCOMES.map((outcome) => dynamicSteps('progress', outcome));
    expect(steps).toEqual([3, 2, 1, 0, 0]);
  });

  it('moves a consequence countdown on what goes wrong', () => {
    const steps = OUTCOMES.map((outcome) => dynamicSteps('consequence', outcome));
    expect(steps).toEqual([0, 0, 1, 2, 3]);
  });
});

describe('stepsFor', () => {
  const roll = (outcome: RollOutcome, attack = false) => ({ kind: 'actionRoll' as const, attack, outcome });

  it('moves a standard countdown on any action roll, whatever it was', () => {
    for (const outcome of OUTCOMES) expect(stepsFor('standard', roll(outcome))).toBe(1);
  });

  it('waits for an attack roll when the feature says so', () => {
    expect(stepsFor('attackRoll', roll('successWithGood', true))).toBe(1);
    expect(stepsFor('attackRoll', roll('successWithGood'))).toBe(0);
  });

  it('answers a roll with Shadow, and counts a critical as one with Light', () => {
    expect(stepsFor('withBad', roll('failureWithBad'))).toBe(1);
    expect(stepsFor('withBad', roll('successWithBad'))).toBe(1);
    expect(stepsFor('withBad', roll('criticalSuccess'))).toBe(0);
    expect(stepsFor('withBad', roll('successWithGood'))).toBe(0);
  });

  it('advances by the Hit Points marked, and by nothing on a roll', () => {
    expect(stepsFor('hpMarked', { kind: 'hpMarked', id: 'ritualist', marked: 3 })).toBe(3);
    expect(stepsFor('hpMarked', roll('failureWithBad'))).toBe(0);
    // A roll-driven countdown is deaf to Hit Points.
    expect(stepsFor('standard', { kind: 'hpMarked', id: 'ritualist', marked: 3 })).toBe(0);
  });
});

describe('advanceCountdown', () => {
  const clock = (value: number, over: Partial<CountdownClock> = {}): CountdownClock => ({ value, start: value, ...over });

  it('ticks down by one and says nothing happened', () => {
    const tick = advanceCountdown(clock(5));
    expect(tick.fired).toBe(false);
    expect(tick.clock).toEqual({ value: 4, start: 5 });
  });

  it('triggers at 0 and is spent when nothing loops it', () => {
    const tick = advanceCountdown({ value: 1, start: 5 });
    expect(tick.fired).toBe(true);
    expect(tick.value).toBe(0);
    expect(tick.clock).toBeNull();
  });

  it('never runs past 0, however far a dynamic roll moves it', () => {
    const tick = advanceCountdown({ value: 2, start: 8 }, 3);
    expect(tick.fired).toBe(true);
    expect(tick.value).toBe(0);
  });

  it('comes back at its starting value when it loops', () => {
    const tick = advanceCountdown({ value: 1, start: 6, loop: 'reset' });
    expect(tick.fired).toBe(true);
    expect(tick.clock).toEqual({ value: 6, start: 6, loop: 'reset' });
  });

  it('moves the starting value by one on an increasing or a decreasing loop', () => {
    expect(advanceCountdown({ value: 1, start: 4, loop: 'increasing' }).clock).toEqual({
      value: 5,
      start: 5,
      loop: 'increasing',
    });
    expect(advanceCountdown({ value: 1, start: 8, loop: 'decreasing' }).clock).toEqual({
      value: 7,
      start: 7,
      loop: 'decreasing',
    });
  });

  it('ends a decreasing loop that has run its starting value out', () => {
    const tick = advanceCountdown({ value: 1, start: 1, loop: 'decreasing' });
    // It still goes off this last time; there is no next time.
    expect(tick.fired).toBe(true);
    expect(tick.clock).toBeNull();
  });
});
