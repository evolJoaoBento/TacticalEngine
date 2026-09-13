import { describe, it, expect } from 'vitest';
import { createRng } from '../core/rng';
import {
  advanceBoard,
  endCreatureCountdowns,
  reapBoard,
  runningCountdownSchema,
  type CountdownBoard,
  type OwnerStatus,
  type RunningCountdown,
} from './countdowns';

const rng = () => createRng(7);

function clock(over: Partial<RunningCountdown> = {}): RunningCountdown {
  return {
    id: 'ritual',
    name: 'Summoning Ritual',
    owner: 'keeper',
    dice: '6',
    value: 6,
    start: 6,
    advance: 'standard',
    onDeath: 'end',
    effects: [{ kind: 'log', text: 'It is done.' }],
    ...over,
  };
}

const board = (...countdowns: RunningCountdown[]): CountdownBoard =>
  new Map(countdowns.map((countdown) => [countdown.id, countdown]));

const ROLL = { kind: 'actionRoll', attack: false, outcome: 'successWithGood' } as const;

describe('advanceBoard', () => {
  it('moves what the cue speaks to and leaves the rest alone', () => {
    const b = board(clock(), clock({ id: 'gaze', advance: 'attackRoll', value: 4, start: 4 }));
    const moved = advanceBoard(b, ROLL, rng());
    expect(moved.map((m) => m.countdown.id)).toEqual(['ritual']);
    expect(b.get('ritual')!.value).toBe(5);
    expect(b.get('gaze')!.value).toBe(4);
  });

  it('only hands a Hit Point cue to the countdown of the one who marked them', () => {
    const b = board(
      clock({ advance: 'hpMarked' }),
      clock({ id: 'other', owner: 'sorcerer', advance: 'hpMarked' }),
    );
    advanceBoard(b, { kind: 'hpMarked', id: 'keeper', marked: 2 }, rng());
    expect(b.get('ritual')!.value).toBe(4);
    expect(b.get('other')!.value).toBe(6);
  });

  it('takes a spent countdown off the board and reports what it was counting towards', () => {
    const b = board(clock({ value: 1 }));
    const moved = advanceBoard(b, ROLL, rng());
    expect(moved[0]!.fired).toBe(true);
    expect(moved[0]!.countdown.effects).toEqual([{ kind: 'log', text: 'It is done.' }]);
    expect(b.size).toBe(0);
  });

  it('rolls a fresh length for a loop whose start is dice', () => {
    const b = board(clock({ dice: '2d6', value: 1, start: 7, loop: 'reset' }));
    expect(advanceBoard(b, ROLL, rng())[0]!.fired).toBe(true);
    const again = b.get('ritual')!;
    expect(again.value).toBe(again.start);
    expect(again.start).toBeGreaterThanOrEqual(2);
    expect(again.start).toBeLessThanOrEqual(12);
  });

  it('keeps the worked-out length for a loop written as a number', () => {
    const b = board(clock({ dice: '8', value: 1, start: 8, loop: 'decreasing' }));
    advanceBoard(b, ROLL, rng());
    expect(b.get('ritual')).toMatchObject({ start: 7, value: 7 });
  });

  it('does not advance a countdown armed by the countdown that just fired', () => {
    const b = board(clock({ value: 1 }));
    const moved = advanceBoard(b, ROLL, rng());
    // The runner arms the second one while the first one's effects play; the
    // board is walked over a snapshot, so it is not caught by this same cue.
    b.set('second', clock({ id: 'second', value: 3 }));
    expect(moved).toHaveLength(1);
    expect(b.get('second')!.value).toBe(3);
  });
});

describe('reapBoard', () => {
  /** The keeper is standing; the tyrant is down; anyone else is elsewhere. */
  const where = (id: string): OwnerStatus => (id === 'keeper' ? 'alive' : id === 'tyrant' ? 'fallen' : 'gone');

  it('ends a countdown with the creature counting it', () => {
    const b = board(clock({ owner: 'tyrant' }));
    expect(reapBoard(b, where)).toEqual([]);
    expect(b.size).toBe(0);
  });

  it('stops the clock of an owner who is simply somewhere else, and stops it quietly', () => {
    // The scenario carries a countdown from room to room; the creature that
    // armed it does not follow. Leaving is not dying, so no death throes.
    const b = board(clock({ owner: 'left-behind', onDeath: 'trigger' }));
    expect(reapBoard(b, where)).toEqual([]);
    expect(b.size).toBe(0);
  });

  it('sets off the one whose feature says it goes off when they fall', () => {
    const b = board(clock({ owner: 'tyrant', onDeath: 'trigger' }));
    const fired = reapBoard(b, where);
    expect(fired.map((m) => m.fired)).toEqual([true]);
    // Off the board either way, so a second death does not fire it again.
    expect(b.size).toBe(0);
    expect(reapBoard(b, where)).toEqual([]);
  });

  it('leaves alone a standing owner, and a countdown nobody owns', () => {
    const b = board(clock(), clock({ id: 'scene-clock', owner: null }));
    expect(reapBoard(b, where)).toEqual([]);
    expect(b.size).toBe(2);
  });
});

describe('endCreatureCountdowns', () => {
  it('stops what a creature was counting and leaves the scene its own clock', () => {
    const b = board(clock(), clock({ id: 'long-term', owner: null }));
    endCreatureCountdowns(b);
    expect([...b.keys()]).toEqual(['long-term']);
  });
});

describe('a countdown in a save', () => {
  it('round-trips through the snapshot schema with what it is counting towards', () => {
    const countdown = clock({
      dice: '1d12',
      loop: 'decreasing',
      onDeath: 'trigger',
      effects: [{ kind: 'summon', adversary: 'minor-demon', range: 'close' }],
    });
    const parsed = runningCountdownSchema.parse(JSON.parse(JSON.stringify(countdown)));
    expect(parsed).toEqual(countdown);
  });
});
