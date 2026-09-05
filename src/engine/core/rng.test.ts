import { describe, it, expect } from 'vitest';
import { createRng, hashSeed, type Rng } from './rng';

const draws = (rng: Rng, n: number) => Array.from({ length: n }, () => rng.next());

describe('createRng', () => {
  it('is deterministic for a given seed', () => {
    expect(draws(createRng(1234), 8)).toEqual(draws(createRng(1234), 8));
  });

  it('produces different streams for different seeds', () => {
    expect(draws(createRng(1), 8)).not.toEqual(draws(createRng(2), 8));
  });

  it('accepts string seeds via a stable hash', () => {
    expect(hashSeed('polyheart')).toBe(hashSeed('polyheart'));
    expect(hashSeed('polyheart')).not.toBe(hashSeed('polyhearu'));
    expect(draws(createRng('polyheart'), 5)).toEqual(draws(createRng(hashSeed('polyheart')), 5));
  });

  it('keeps next() inside [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('rolls dice inside [1, sides] and covers every face', () => {
    const rng = createRng('dice');
    const seen = new Set<number>();
    for (let i = 0; i < 5_000; i++) {
      const v = rng.die(12);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(12);
      seen.add(v);
    }
    expect(seen.size).toBe(12);
  });

  it('distributes d12 faces roughly evenly', () => {
    const rng = createRng('uniformity');
    const counts = new Array(12).fill(0) as number[];
    const n = 120_000;
    for (let i = 0; i < n; i++) counts[rng.die(12) - 1]!++;
    const expected = n / 12;
    for (const c of counts) expect(Math.abs(c - expected) / expected).toBeLessThan(0.05);
  });

  it('rejects invalid bounds', () => {
    const rng = createRng(0);
    expect(() => rng.nextInt(0)).toThrow(RangeError);
    expect(() => rng.nextInt(2.5)).toThrow(RangeError);
    expect(() => rng.die(-1)).toThrow(RangeError);
    expect(() => rng.dice(-1, 6)).toThrow(RangeError);
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it('rolls dice() in order and with the right length', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(a.dice(3, 6)).toEqual([b.die(6), b.die(6), b.die(6)]);
    expect(createRng(1).dice(0, 6)).toEqual([]);
  });

  it('shuffles in place, keeps the multiset, and is seed-stable', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const target = [...items];
    const returned = createRng('shuffle').shuffle(target);
    expect(returned).toBe(target);
    expect([...target].sort((x, y) => x - y)).toEqual(items);
    expect(target).not.toEqual(items);
    expect(createRng('shuffle').shuffle([...items])).toEqual(target);
  });

  it('save/restore replays the same sub-stream', () => {
    const rng = createRng('save');
    rng.dice(5, 12);
    const mark = rng.save();
    const first = rng.dice(6, 12);
    rng.restore(mark);
    expect(rng.dice(6, 12)).toEqual(first);
  });

  it('forks into an independent stream and advances the parent', () => {
    const parent = createRng('fork');
    const child = parent.fork();
    const parentAfterFork = parent.dice(6, 12);
    const childRolls = child.dice(6, 12);
    expect(childRolls).not.toEqual(parentAfterFork);

    // Forking is itself deterministic, and the parent's stream is shifted by exactly one draw.
    const replay = createRng('fork');
    replay.fork();
    expect(replay.dice(6, 12)).toEqual(parentAfterFork);

    const unforked = createRng('fork');
    unforked.next();
    expect(unforked.dice(6, 12)).toEqual(parentAfterFork);
  });

  it('picks from an array within bounds', () => {
    const rng = createRng('pick');
    const items = ['a', 'b', 'c'] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(rng.pick(items));
    expect([...seen].sort()).toEqual(['a', 'b', 'c']);
  });
});
