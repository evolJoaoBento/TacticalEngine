/**
 * A card dragged on the HUD: read against the column, and done to the party.
 */

import { describe, expect, it } from 'vitest';
import { ASIDE, dropTargetAt, type CardBox } from './party-drop';

// Four cards, 100 tall, 10 apart, in a column 160 wide at the left edge.
const column: CardBox[] = ['kara', 'finn', 'mira', 'rook'].map((id, i) => ({ id, top: 20 + i * 110, bottom: 120 + i * 110, left: 10, right: 170 }));

describe('where a card is dropped', () => {
  it('is to the side past the column’s edge, either way', () => {
    expect(dropTargetAt(column, 'finn', 170 + ASIDE + 1, 60)).toEqual({ kind: 'aside' });
    expect(dropTargetAt(column, 'finn', 10 - ASIDE - 1, 60)).toEqual({ kind: 'aside' });
    expect(dropTargetAt(column, 'finn', 170 + ASIDE - 1, 60)).not.toEqual({ kind: 'aside' });
  });

  it('is onto a card over its middle, and between over its edges or the gaps', () => {
    // Over Scarlet's middle, and over her top and bottom quarters.
    expect(dropTargetAt(column, 'finn', 80, 290)).toEqual({ kind: 'onto', id: 'mira' });
    expect(dropTargetAt(column, 'finn', 80, 250)).toEqual({ kind: 'between', above: 'kara', below: 'mira' });
    expect(dropTargetAt(column, 'finn', 80, 335)).toEqual({ kind: 'between', above: 'mira', below: 'rook' });
    // The gap between Scarlet and Rook, above everybody, and below everybody.
    expect(dropTargetAt(column, 'finn', 80, 345)).toEqual({ kind: 'between', above: 'mira', below: 'rook' });
    expect(dropTargetAt(column, 'finn', 80, 5)).toEqual({ kind: 'between', above: null, below: 'kara' });
    expect(dropTargetAt(column, 'finn', 80, 500)).toEqual({ kind: 'between', above: 'rook', below: null });
    // The card in the hand is not one to drop on: its own box is a gap between its neighbours.
    expect(dropTargetAt(column, 'finn', 80, 180)).toEqual({ kind: 'between', above: 'kara', below: 'mira' });
  });

  it('is nowhere with nobody else', () => {
    expect(dropTargetAt(column.slice(0, 1), 'kara', 80, 60)).toBeNull();
  });
});
