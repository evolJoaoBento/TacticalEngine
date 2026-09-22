/**
 * Dragging a card on the party HUD: where it may be dropped, and what a drop does.
 *
 * The cards are a column, and a card picked up is put down in one of three places. To the
 * side of the column, and its character walks alone from now on. On top of another card, and
 * they walk with that character, their card falling in under theirs. Between two cards, and
 * the party is read in that order from now on - and where the two either side walk together,
 * so does the one put between them. Both halves are pure, so the HUD only measures its cards
 * and the tests need no DOM: `dropTargetAt` reads a pointer against the cards' boxes, and
 * `dropCard` tells the party what the drop meant.
 */

import type { Party } from '../engine/scene/party';

/** What a drop lands on. */
export type Drop =
  | { kind: 'aside' }
  | { kind: 'onto'; id: string }
  | { kind: 'between'; above: string | null; below: string | null };

/** A card's box on the screen, in whatever units the pointer is read in. */
export interface CardBox {
  id: string;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** How far past the column's edge a card is dragged before it is "to the side", in the boxes' units. */
export const ASIDE = 40;
/** The part of a card, top and bottom, that is "between" rather than "onto". */
const EDGE = 0.25;

/**
 * Where a pointer is over the column, dragging `dragging`: to the side of it, on another card,
 * or between two. Null with nothing to drop on - a party of one.
 */
export function dropTargetAt(cards: readonly CardBox[], dragging: string, x: number, y: number): Drop | null {
  const others = cards.filter((card) => card.id !== dragging);
  if (others.length === 0) return null;
  const left = Math.min(...others.map((card) => card.left));
  const right = Math.max(...others.map((card) => card.right));
  if (x > right + ASIDE || x < left - ASIDE) return { kind: 'aside' };
  for (let i = 0; i < others.length; i++) {
    const card = others[i]!;
    const above = others[i - 1]?.id ?? null;
    const below = others[i + 1]?.id ?? null;
    // Above this card, and below the one before it: the gap between them.
    if (y < card.top) return { kind: 'between', above, below: card.id };
    if (y > card.bottom) continue;
    const edge = (card.bottom - card.top) * EDGE;
    if (y < card.top + edge) return { kind: 'between', above, below: card.id };
    if (y > card.bottom - edge) return { kind: 'between', above: card.id, below };
    return { kind: 'onto', id: card.id };
  }
  return { kind: 'between', above: others[others.length - 1]!.id, below: null };
}

/** Do what the drop meant. Returns whether anything changed: who walks with whom, or the order. */
export function dropCard(party: Party, id: string, drop: Drop): boolean {
  switch (drop.kind) {
    case 'aside':
      return party.unlink(id);
    case 'onto': {
      // With them, and under them.
      const linked = party.link(id, drop.id);
      const members = party.members().filter((other) => other !== id);
      const under = members[members.indexOf(drop.id) + 1] ?? null;
      return party.arrange(id, under) || linked;
    }
    case 'between': {
      const moved = party.arrange(id, drop.below);
      // Put between two who walk together, they walk with them.
      const joins = drop.above !== null && drop.below !== null && party.linked(drop.above, drop.below) && party.link(id, drop.above);
      return moved || joins;
    }
  }
}
