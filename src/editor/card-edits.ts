/**
 * The card and ability edits: what the Cards panel runs.
 *
 * A card is two documents. `project.cards[i]` says who holds it and what it costs to hold; the
 * ability on it (`project.abilities[i]`, `source.card` naming the card) says what it does. Both
 * carry a name and a text, and the player sees only one of each: the deck browser and a card face
 * read the card's, the action bar reads the ability's. `updateCardWords` is the edit that keeps
 * them one thing; the rest are the plain edits over each document.
 */

import type { ProjectDoc } from '../engine/scene/schema';
import { cardOf, type AbilityDef } from '../engine/content/abilities';
import type { Edit } from './session';

/** One of the project's own cards, as the document stores it. */
export type ProjectCard = ProjectDoc['cards'][number];

/** Add a card. Its id is what a sheet's loadout and a token effect will name. */
export function addAbility(ability: AbilityDef): Edit {
  return {
    label: `Add card ${ability.id}`,
    apply(project) {
      project.abilities.push(ability);
    },
    undo(project) {
      const at = project.abilities.lastIndexOf(ability);
      if (at >= 0) project.abilities.splice(at, 1);
    },
  };
}

/**
 * Delete a card.
 *
 * A character sheet may still hold it. That is left alone here, the same way a
 * deleted piece of code is: the validator reports what now names nothing, which
 * is what an author needs to see.
 */
export function removeAbility(abilityId: string): Edit {
  let removed: { index: number; ability: AbilityDef } | null = null;
  return {
    label: 'Delete card',
    apply(project) {
      removed = null;
      const index = project.abilities.findIndex((a) => a.id === abilityId);
      if (index < 0) return;
      removed = { index, ability: project.abilities[index]! };
      project.abilities.splice(index, 1);
    },
    undo(project) {
      if (removed !== null) project.abilities.splice(removed.index, 0, removed.ability);
    },
    isNoop() {
      return removed === null;
    },
  };
}

/**
 * Edit a card. Typing into one field coalesces into one undo step, as the
 * other text editors do; changing a different field starts a new one.
 */
export function updateAbility(abilityId: string, changes: Partial<AbilityDef>): Edit {
  let before: AbilityDef | null = null;
  const current: Partial<AbilityDef> = { ...changes };
  const edit: Edit = {
    label: 'Edit card',
    mergeKey: `ability:${abilityId}:${Object.keys(changes).sort().join(',')}`,
    apply(project) {
      const index = project.abilities.findIndex((a) => a.id === abilityId);
      if (index < 0) return;
      before = project.abilities[index]!;
      project.abilities[index] = { ...before, ...current };
    },
    undo(project) {
      if (before === null) return;
      const index = project.abilities.findIndex((a) => a.id === abilityId);
      if (index >= 0) project.abilities[index] = before;
    },
    absorb(other) {
      const next = (other as Edit & { __ability?: Partial<AbilityDef> }).__ability;
      if (next === undefined) return false;
      Object.assign(current, next);
      return true;
    },
  };
  (edit as Edit & { __ability: Partial<AbilityDef> }).__ability = current;
  return edit;
}

/** The two fields a card and its ability both carry, and the player reads as one. */
export interface CardWords {
  name?: string;
  text?: string;
}

/**
 * Edit a card's name or text as the player reads them: on the ability, and on the card when it is
 * the project's own and this ability is the one thing on it -- a pack's card keeps its words, and
 * "Edit a copy" is how they change; a card two abilities sit on, a grimoire with its spells, has a
 * name and a text of its own, and one spell's words are not the book's. One undo step restores
 * both; typing coalesces by field, as `updateAbility` does.
 */
export function updateCardWords(cardId: string, abilityId: string, words: CardWords): Edit {
  let ability: AbilityDef | null = null;
  let card: ProjectCard | null = null;
  const current: CardWords = { ...words };
  const edit: Edit = {
    label: 'Edit card',
    mergeKey: `words:${abilityId}:${Object.keys(words).sort().join(',')}`,
    apply(project) {
      ability = null;
      card = null;
      const at = project.abilities.findIndex((a) => a.id === abilityId);
      if (at < 0) return;
      ability = project.abilities[at]!;
      project.abilities[at] = { ...ability, ...current };
      const on = project.cards.findIndex((c) => c.id === cardId);
      if (on < 0 || project.abilities.filter((a) => cardOf(a) === cardId).length !== 1) return;
      card = project.cards[on]!;
      project.cards[on] = { ...card, ...current };
    },
    undo(project) {
      if (card !== null) {
        const on = project.cards.findIndex((c) => c.id === cardId);
        if (on >= 0) project.cards[on] = card;
      }
      if (ability !== null) {
        const at = project.abilities.findIndex((a) => a.id === abilityId);
        if (at >= 0) project.abilities[at] = ability;
      }
    },
    absorb(other) {
      const next = (other as Edit & { __words?: CardWords }).__words;
      if (next === undefined) return false;
      Object.assign(current, next);
      return true;
    },
    isNoop() {
      return ability === null;
    },
  };
  (edit as Edit & { __words: CardWords }).__words = current;
  return edit;
}

/**
 * Add a card and the ability on it, as one step.
 *
 * "+ Card" in the Cards panel is one thing to an author, so it is one thing to take back: the
 * card says who holds it, and the ability says what it does.
 */
export function addCardWithAbility(card: ProjectCard, ability: AbilityDef): Edit {
  return {
    label: `Add card ${card.id}`,
    apply(project) {
      project.cards.push(card);
      project.abilities.push(ability);
    },
    undo(project) {
      const at = project.abilities.lastIndexOf(ability);
      if (at >= 0) project.abilities.splice(at, 1);
      const on = project.cards.lastIndexOf(card);
      if (on >= 0) project.cards.splice(on, 1);
    },
  };
}

/**
 * Delete an ability, and the card it sits on when that card is one "+ Card" wrote: the project's
 * own, handed to named characters, with nothing else sitting on it. A card a pack, a class or a
 * loadout brings stays -- deleting what a card does is not deleting the card.
 */
export function removeCardWithAbility(abilityId: string): Edit {
  let removed: { index: number; ability: AbilityDef } | null = null;
  let dropped: { index: number; card: ProjectCard } | null = null;
  return {
    label: 'Delete card',
    apply(project) {
      removed = null;
      dropped = null;
      const index = project.abilities.findIndex((a) => a.id === abilityId);
      if (index < 0) return;
      const ability = project.abilities[index]!;
      removed = { index, ability };
      project.abilities.splice(index, 1);
      const cardId = cardOf(ability);
      const at = project.cards.findIndex((c) => c.id === cardId);
      if (at < 0 || project.cards[at]!.grant.kind !== 'given') return;
      if (project.abilities.some((a) => cardOf(a) === cardId)) return;
      dropped = { index: at, card: project.cards[at]! };
      project.cards.splice(at, 1);
    },
    undo(project) {
      if (dropped !== null) project.cards.splice(dropped.index, 0, dropped.card);
      if (removed !== null) project.abilities.splice(removed.index, 0, removed.ability);
    },
    isNoop() {
      return removed === null;
    },
  };
}

/**
 * Edit one of the project's own cards. Typing into one field coalesces into one undo step, as the
 * other text editors do; changing a different field starts a new one.
 */
export function updateCard(cardId: string, changes: Partial<ProjectCard>): Edit {
  let before: ProjectCard | null = null;
  const current: Partial<ProjectCard> = { ...changes };
  const edit: Edit = {
    label: 'Edit card',
    mergeKey: `card:${cardId}:${Object.keys(changes).sort().join(',')}`,
    apply(project) {
      const index = project.cards.findIndex((c) => c.id === cardId);
      if (index < 0) return;
      before = project.cards[index]!;
      project.cards[index] = { ...before, ...current };
    },
    undo(project) {
      if (before === null) return;
      const index = project.cards.findIndex((c) => c.id === cardId);
      if (index >= 0) project.cards[index] = before;
    },
    absorb(other) {
      const next = (other as Edit & { __card?: Partial<ProjectCard> }).__card;
      if (next === undefined) return false;
      Object.assign(current, next);
      return true;
    },
  };
  (edit as Edit & { __card: Partial<ProjectCard> }).__card = current;
  return edit;
}

/**
 * Add a card of the project's own. What "Edit a copy" runs on a pack's card: a project's card lays
 * over the pack's by id, whole, so the copy is the card played from then on and the pack is never
 * written. A card the project already has under that id is left where it is, and the edit is a no-op.
 */
export function addCard(card: ProjectCard): Edit {
  let added = false;
  return {
    label: `Add card ${card.id}`,
    apply(project) {
      added = !project.cards.some((c) => c.id === card.id);
      if (added) project.cards.push(card);
    },
    undo(project) {
      if (!added) return;
      const on = project.cards.lastIndexOf(card);
      if (on >= 0) project.cards.splice(on, 1);
    },
    isNoop() {
      return !added;
    },
  };
}

/**
 * Take a card of the project's own out of it. What "Remove copy" runs on a copy of a pack's card:
 * with the project's card gone, `mergePack` has nothing to lay over the pack's, so the pack's is the
 * card played again. The abilities on it stay where they are, on the pack's card under the same id.
 * A card the project does not have makes the edit a no-op.
 */
export function removeCard(cardId: string): Edit {
  let removed: { index: number; card: ProjectCard } | null = null;
  return {
    label: `Remove card ${cardId}`,
    apply(project) {
      removed = null;
      const index = project.cards.findIndex((c) => c.id === cardId);
      if (index < 0) return;
      removed = { index, card: project.cards[index]! };
      project.cards.splice(index, 1);
    },
    undo(project) {
      if (removed !== null) project.cards.splice(removed.index, 0, removed.card);
    },
    isNoop() {
      return removed === null;
    },
  };
}
