import { describe, it, expect } from 'vitest';
import { createRng } from '../core/rng';
import { lootTableSchema, rollLoot } from './items';

/**
 * Drawing from a loot table.
 *
 * Weighted, seeded, and stacked: the same seed opens the same chest, which is
 * the rule everywhere else in the engine and has to hold here too or a replay
 * diverges the moment someone loots something.
 */

const table = (overrides: Record<string, unknown> = {}) =>
  lootTableSchema.parse({
    id: 'chest',
    rolls: 1,
    entries: [{ item: 'gold', quantity: 5 }],
    ...overrides,
  });

describe('rolling loot', () => {
  it('gives what the only entry says', () => {
    expect(rollLoot(table(), createRng(1))).toEqual([{ item: 'gold', quantity: 5 }]);
  });

  it('is replayable from a seed', () => {
    const rich = table({
      rolls: 4,
      entries: [
        { item: 'gold', quantity: { min: 1, max: 20 }, weight: 3 },
        { item: 'draught', quantity: 1, weight: 1 },
      ],
    });
    expect(rollLoot(rich, createRng(99))).toEqual(rollLoot(rich, createRng(99)));
  });

  it('stacks repeats into one pile rather than listing them twice', () => {
    const found = rollLoot(table({ rolls: 3 }), createRng(4));
    expect(found).toEqual([{ item: 'gold', quantity: 15 }]);
  });

  it('rolls a quantity inside its range, every time', () => {
    const ranged = table({ rolls: 1, entries: [{ item: 'gold', quantity: { min: 4, max: 12 } }] });
    for (let seed = 0; seed < 200; seed++) {
      const [drop] = rollLoot(ranged, createRng(seed));
      expect(drop!.quantity).toBeGreaterThanOrEqual(4);
      expect(drop!.quantity).toBeLessThanOrEqual(12);
    }
  });

  it('reaches both ends of a range', () => {
    const ranged = table({ rolls: 1, entries: [{ item: 'gold', quantity: { min: 1, max: 3 } }] });
    const seen = new Set<number>();
    for (let seed = 0; seed < 200; seed++) seen.add(rollLoot(ranged, createRng(seed))[0]!.quantity);
    // An off-by-one in the range would lose 1 or 3.
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it('respects the weights, roughly', () => {
    const weighted = table({
      rolls: 1,
      entries: [
        { item: 'common', quantity: 1, weight: 9 },
        { item: 'rare', quantity: 1, weight: 1 },
      ],
    });
    let rare = 0;
    for (let seed = 0; seed < 1000; seed++) {
      if (rollLoot(weighted, createRng(seed))[0]!.item === 'rare') rare++;
    }
    // One in ten, give or take; a broken weight would be 0 or ~500.
    expect(rare).toBeGreaterThan(40);
    expect(rare).toBeLessThan(180);
  });

  it('can reach every entry', () => {
    const three = table({
      rolls: 1,
      entries: [
        { item: 'a', quantity: 1 },
        { item: 'b', quantity: 1 },
        { item: 'c', quantity: 1 },
      ],
    });
    const seen = new Set<string>();
    for (let seed = 0; seed < 300; seed++) seen.add(rollLoot(three, createRng(seed))[0]!.item);
    expect([...seen].sort()).toEqual(['a', 'b', 'c']);
  });

  it('finds nothing when a table rolls no times', () => {
    expect(rollLoot(table({ rolls: 0 }), createRng(1))).toEqual([]);
  });

  it('refuses a range that runs backwards', () => {
    expect(() =>
      lootTableSchema.parse({
        id: 'bad',
        entries: [{ item: 'gold', quantity: { min: 10, max: 2 } }],
      }),
    ).toThrow();
  });

  it('refuses a table with nothing in it', () => {
    expect(() => lootTableSchema.parse({ id: 'empty', entries: [] })).toThrow();
  });
});
