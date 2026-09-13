import { describe, it, expect } from 'vitest';
import { abilitySchema } from '../engine/content/abilities';
import { cardDefSchema } from '../engine/content/pack/schema';
import { STARTER_ABILITIES, STARTER_CHARACTERS } from '../engine/content/pack/starter';
import type { ProjectDoc } from '../engine/scene/schema';
import { scriptIdFor, unscriptedCards } from './card-list';

describe('the cards no ability sits on', () => {
  it("lists the pack's text-only cards and a bare card of the project's, until something is written on them", () => {
    const project: Pick<ProjectDoc, 'cards' | 'abilities'> = { cards: [], abilities: [...STARTER_ABILITIES] };
    const ids = () => unscriptedCards(STARTER_CHARACTERS, project).map((card) => card.id);
    // Twenty-two of the pack's thirty-nine cards carry no ability: three a character chooses, and
    // nineteen features a class, subclass, ancestry or community prints as text.
    const chosen = () =>
      unscriptedCards(STARTER_CHARACTERS, project)
        .filter((card) => card.grant.kind === 'chosen')
        .map((card) => card.id);
    expect(STARTER_CHARACTERS.cards.size).toBe(39);
    expect(ids()).toHaveLength(22);
    expect(chosen()).toEqual(['rallying-cry', 'smoke-step', 'cut-purse-strings']);

    // A card of the project's own with nothing on it joins them, and a copy of a pack card is that
    // card, as the project has it -- one entry, not two.
    project.cards.push(cardDefSchema.parse({ id: 'oath', name: 'Oath', grant: { kind: 'given', characters: [] } }));
    project.cards.push(cardDefSchema.parse({ ...STARTER_CHARACTERS.cards.get('rallying-cry')!, text: 'Louder.' }));
    expect(ids()).toHaveLength(23);
    expect(ids()[ids().length - 1]).toBe('oath');
    expect(unscriptedCards(STARTER_CHARACTERS, project).find((card) => card.id === 'rallying-cry')!.text).toBe('Louder.');

    // A script on it takes it off the list: it is reached through its ability now.
    project.abilities.push(abilitySchema.parse({ id: 'rallying-cry', name: 'Rallying Cry', source: { card: 'rallying-cry' } }));
    expect(ids()).not.toContain('rallying-cry');
    expect(ids()).toHaveLength(22);
  });

  it('names the first script after its card, and numbers it when that name is taken', () => {
    const on = (id: string) => abilitySchema.parse({ id, name: id, source: { card: 'elsewhere' } });
    expect(scriptIdFor('oath', [])).toBe('oath');
    expect(scriptIdFor('oath', [on('oath'), on('oath-2')])).toBe('oath-3');
  });
});
