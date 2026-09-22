/**
 * The chain behind the cards: one per group of more than one, from its first card to its last.
 */

import { describe, expect, it } from 'vitest';
import { chainSpans, strandedIds } from './party-chain';

const column = (...groups: (number | null)[]): { id: string; group: number | null }[] =>
  groups.map((group, i) => ({ id: `card${i}`, group }));

describe('the chains behind a column of cards', () => {
  it('runs one from the first card of a group to its last', () => {
    expect(chainSpans(column(0, 0, 0))).toEqual([{ group: 0, from: 'card0', to: 'card2' }]);
    expect(chainSpans(column(0, 0, 1, 1))).toEqual([
      { group: 0, from: 'card0', to: 'card1' },
      { group: 1, from: 'card2', to: 'card3' },
    ]);
  });

  it('leaves out anybody who walks alone, and a group of one', () => {
    expect(chainSpans(column(null, null))).toEqual([]);
    expect(chainSpans(column(0, null))).toEqual([]);
    expect(chainSpans([])).toEqual([]);
  });

  it('is broken by a card that is not in the group, rather than running behind it', () => {
    // A group split up the column: neither half has anybody next to it, so no chain is drawn at all.
    expect(chainSpans(column(0, null, 0))).toEqual([]);
    expect(chainSpans(column(0, 1, 0))).toEqual([]);
    // Two of them together, and the third stranded: the chain is the pair's.
    expect(chainSpans(column(0, 0, null, 0))).toEqual([{ group: 0, from: 'card0', to: 'card1' }]);
    // The same group either side of a stranger: a chain each.
    expect(chainSpans(column(0, 0, 1, 0, 0))).toEqual([
      { group: 0, from: 'card0', to: 'card1' },
      { group: 0, from: 'card3', to: 'card4' },
    ]);
  });

  it('is in the order the runs come down the column', () => {
    expect(chainSpans(column(1, 1, 0, 0)).map((span) => span.group)).toEqual([1, 0]);
  });

  it('names whoever no chain reaches, so their card can show its group another way', () => {
    expect(strandedIds(column(0, 0, 0))).toEqual([]);
    expect(strandedIds(column(null, null))).toEqual([]);
    expect(strandedIds(column(0, 1, 0))).toEqual(['card0', 'card1', 'card2']);
    expect(strandedIds(column(0, 0, null, 0))).toEqual(['card3']);
  });
});
