/**
 * A card dragged on the HUD: read against the column, and done to the party.
 */

import { describe, expect, it } from 'vitest';
import { TileGrid } from '../engine/grid/grid';
import { Pathfinder } from '../engine/grid/pathfinding';
import { Party } from '../engine/scene/party';
import { SceneState, createPartyEntity } from '../engine/scene/state';
import { ASIDE, dropCard, dropTargetAt, type CardBox } from './party-drop';

function party(): Party {
  const grid = new TileGrid({ width: 10, height: 3 });
  const state = new SceneState({ id: 'room' }, grid);
  state.addEntity(createPartyEntity('kara', 'sentinel', grid.indexOf(0, 1)));
  state.addEntity(createPartyEntity('finn', 'nightwalker', grid.indexOf(0, 0)));
  state.addEntity(createPartyEntity('mira', 'seer', grid.indexOf(0, 2)));
  state.addEntity(createPartyEntity('rook', 'warden', grid.indexOf(1, 1)));
  return new Party(state, new Pathfinder(grid));
}

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

describe('what a drop does', () => {
  it('to the side: they walk alone, and go above the group they left', () => {
    const p = party();
    expect(dropCard(p, 'finn', { kind: 'aside' })).toBe(true);
    expect(p.groupOf('finn')).toEqual(['finn']);
    expect(dropCard(p, 'finn', { kind: 'aside' })).toBe(false);
    // Out of the middle, so the three still walking together are side by side and stay chained.
    expect(p.members()).toEqual(['finn', 'kara', 'mira', 'rook']);
    expect(p.groupOf('kara')).toEqual(['kara', 'mira', 'rook']);
  });

  it('onto a card: they walk with that character, and their card goes under theirs', () => {
    const p = party();
    p.unlink('finn');
    expect(dropCard(p, 'finn', { kind: 'onto', id: 'mira' })).toBe(true);
    expect(p.linked('finn', 'mira')).toBe(true);
    expect(p.members()).toEqual(['kara', 'mira', 'finn', 'rook']);
    // Onto the last card: last.
    dropCard(p, 'kara', { kind: 'onto', id: 'rook' });
    expect(p.members()).toEqual(['mira', 'finn', 'rook', 'kara']);
    // Already with them and under them: nothing to do.
    expect(dropCard(p, 'kara', { kind: 'onto', id: 'rook' })).toBe(false);
  });

  it('between two cards: the order, and the group of the two either side', () => {
    const p = party();
    p.unlink('mira');
    p.unlink('rook');
    // Scarlet between Quim and Violet, who walk together: she walks with them, third card.
    expect(dropCard(p, 'mira', { kind: 'between', above: 'kara', below: 'finn' })).toBe(true);
    expect(p.members()).toEqual(['kara', 'mira', 'finn', 'rook']);
    expect(p.groupOf('mira')).toEqual(['kara', 'mira', 'finn']);
    // Rook between Violet and nobody: the order alone, since there is nobody below to be with.
    expect(dropCard(p, 'rook', { kind: 'between', above: 'finn', below: null })).toBe(false); // already last
    expect(dropCard(p, 'rook', { kind: 'between', above: null, below: 'kara' })).toBe(true);
    expect(p.members()).toEqual(['rook', 'kara', 'mira', 'finn']);
    expect(p.groupOf('rook')).toEqual(['rook']);
    // Between two who do not walk together: the order alone.
    p.unlink('finn');
    expect(dropCard(p, 'rook', { kind: 'between', above: 'mira', below: 'finn' })).toBe(true);
    expect(p.members()).toEqual(['kara', 'mira', 'rook', 'finn']);
    expect(p.groupOf('rook')).toEqual(['rook']);
    // Somebody already in the group put between two of it: the order alone, and still with them.
    expect(dropCard(p, 'kara', { kind: 'between', above: 'mira', below: 'rook' })).toBe(true);
    expect(p.members()).toEqual(['mira', 'kara', 'rook', 'finn']);
    expect(p.groupOf('kara')).toEqual(['mira', 'kara']);
  });
});
