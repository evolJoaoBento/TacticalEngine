/**
 * The cards the Cards panel lists on their own: the ones no ability sits on.
 *
 * The panel is a list of abilities, because an ability is what an author scripts -- and a card with
 * none on it would be reached by nothing. That is the pack's text-only cards, and every card an
 * imported pack brings without a script: still cards, chosen into a loadout or granted, and read by
 * the table. Listed so they can be granted, numbered, reworded or given a script like any other.
 */

import { cardOf, type AbilityDef } from '../engine/content/abilities';
import { mergePack, type CardDef, type ContentPack } from '../engine/content/pack/import';
import type { ProjectDoc } from '../engine/scene/schema';

/**
 * The cards in play for this project -- the pack's, with the project's own laid over them as they
 * stand now -- that no ability sits on: the pack's order first, then the project's.
 */
export function unscriptedCards(content: ContentPack, project: Pick<ProjectDoc, 'cards' | 'abilities'>): CardDef[] {
  const scripted = new Set(project.abilities.map(cardOf));
  return [...mergePack(content, { cards: project.cards }).cards.values()].filter((card) => !scripted.has(card.id));
}

/** An id for the first ability on a card: the card's own when no ability has it, numbered after that. */
export function scriptIdFor(cardId: string, abilities: readonly AbilityDef[]): string {
  const taken = new Set(abilities.map((ability) => ability.id));
  if (!taken.has(cardId)) return cardId;
  let n = 2;
  while (taken.has(`${cardId}-${n}`)) n++;
  return `${cardId}-${n}`;
}
