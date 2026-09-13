import { describe, it, expect } from 'vitest';
import { abilitySchema } from '../engine/content/abilities';
import { blankScene } from '../engine/scene/grid-from-scene';
import { projectSchema, sceneSchema, type ProjectDoc } from '../engine/scene/schema';
import { cardDefSchema } from '../engine/content/pack/schema';
import { isDomainCard, mergePack } from '../engine/content/pack/import';
import { STARTER_CHARACTERS } from '../engine/content/pack/starter';
import { blankSheet } from '../engine/character/sheet';
import {
  EditorSession,
  addAbility,
  addCard,
  addCardWithAbility,
  removeAbility,
  removeCard,
  removeCardWithAbility,
  updateAbility,
  updateCard,
} from './session';
import { validateProject } from './validate';

/**
 * Editing a card as a document. The Cards panel is a view over these three
 * edits; every keystroke is one of them, coalesced by field, which is what
 * makes typing a card's text one undo rather than forty.
 */

const RALLY = {
  id: 'rally',
  name: 'Rally',
  source: { card: 'rally' },
  text: 'Shout, and they stand a little straighter.',
  cost: { good: 1 },
  effects: [{ kind: 'log', text: 'Kara shouts.' }],
};

function project(): ProjectDoc {
  return projectSchema.parse({
    id: 'demo',
    name: 'Demo',
    scenes: [sceneSchema.parse(blankScene('room', 6, 4))],
    abilities: [abilitySchema.parse(RALLY)],
    startScene: 'room',
  });
}

const session = (): EditorSession => new EditorSession(project());
const rally = (s: EditorSession) => s.project.abilities[0]!;

describe('a cost only the GM can pay', () => {
  it('warns when a card asks its holder for a Shadow, and not when a stat block does', () => {
    const s = session();
    s.run(updateAbility('rally', { cost: { bad: 1 } }));
    expect(validateProject(s.project).map((p) => p.message).join(' ')).toContain('only the GM spends');

    // The same cost on a stat block's feature is exactly where it belongs: the card it sits on,
    // printed on a block rather than handed to Kara.
    s.project.cards.push(cardDefSchema.parse({ id: 'rally', name: 'Rally', grant: { kind: 'given', characters: ['kara'] } }));
    s.run(updateCard('rally', { grant: { kind: 'adversary', adversaries: ['acid-burrower'] } }));
    expect(validateProject(s.project)).toEqual([]);
  });
});

describe('cards in the project', () => {
  it('adds and removes one, putting it back where it was', () => {
    const s = session();
    s.run(addAbility(abilitySchema.parse({ ...RALLY, id: 'other', name: 'Other' })));
    expect(s.project.abilities.map((a) => a.id)).toEqual(['rally', 'other']);

    expect(s.run(removeAbility('rally'))).toBe(true);
    expect(s.project.abilities.map((a) => a.id)).toEqual(['other']);
    s.undo();
    expect(s.project.abilities.map((a) => a.id)).toEqual(['rally', 'other']);
  });

  it('removing a card that is not there is a no-op, not an undo step', () => {
    const s = session();
    expect(s.run(removeAbility('nope'))).toBe(false);
    expect(s.canUndo).toBe(false);
  });

  it('deletes the card "+ Card" wrote with its ability, as one step, and no card anything else needs', () => {
    const s = session();
    const oath = (id: string, grant: Record<string, unknown>) => cardDefSchema.parse({ id, name: id, grant });
    const on = (id: string, card: string) => abilitySchema.parse({ id, name: id, source: { card } });
    s.run(addCardWithAbility(oath('oath', { kind: 'given', characters: ['kara'] }), on('oath', 'oath')));
    expect(s.project.cards.map((c) => c.id)).toEqual(['oath']);

    s.run(removeCardWithAbility('oath'));
    expect(s.project.cards).toEqual([]);
    expect(s.project.abilities.map((a) => a.id)).toEqual(['rally']);
    s.undo();
    expect(s.project.cards.map((c) => c.id)).toEqual(['oath']);
    expect(s.project.abilities.map((a) => a.id)).toEqual(['rally', 'oath']);

    // A card a class grants is not the author's to lose by deleting what it does; nor is a given
    // card another ability still sits on.
    s.run(addCardWithAbility(oath('drill', { kind: 'class', classId: 'sentinel' }), on('drill', 'drill')));
    s.run(addAbility(on('oath-again', 'oath')));
    s.run(removeCardWithAbility('drill'));
    s.run(removeCardWithAbility('oath'));
    expect(s.project.cards.map((c) => c.id)).toEqual(['oath', 'drill']);
    expect(s.project.abilities.map((a) => a.id)).toEqual(['rally', 'oath-again']);
  });

  it('grants a card every way the panel offers, and each is a document that loads', () => {
    const s = session();
    s.run(
      addCardWithAbility(
        cardDefSchema.parse({ id: 'oath', name: 'Oath', grant: { kind: 'given', characters: [] } }),
        abilitySchema.parse({ id: 'oath', name: 'Oath', source: { card: 'oath' } }),
      ),
    );
    // `updateCard` merges without parsing, so what it writes has to be something the schema reads
    // back: a loadout goes with the four numbers a chosen card cannot load without, as the panel
    // writes it, and only then is it a card somebody can take into one.
    const changes: Partial<ProjectDoc['cards'][number]>[] = [
      { grant: { kind: 'chosen' }, domain: 'bulwark', type: 'ability', level: 2, recallCost: 1 },
      { grant: { kind: 'given', characters: ['kara', 'mira'] } },
      { grant: { kind: 'class', classId: 'sentinel' } },
      { grant: { kind: 'subclass', subclassId: 'shieldbearer', stage: 'mastery' } },
      { grant: { kind: 'ancestry', ancestryId: 'human' } },
      { grant: { kind: 'community', communityId: 'wayfarer' } },
      { grant: { kind: 'adversary', adversaries: ['husk'] } },
    ];
    for (const change of changes) {
      s.run(updateCard('oath', change));
      const loaded = projectSchema.parse(JSON.parse(JSON.stringify(s.project)));
      expect(loaded.cards.find((c) => c.id === 'oath')!.grant).toEqual(change.grant);
      expect(isDomainCard(mergePack(STARTER_CHARACTERS, loaded).cards.get('oath')!)).toBe(change.grant!.kind === 'chosen');
    }
  });

  it('deletes a card of the project\'s own, and Check says so of a sheet still holding it', () => {
    const s = session();
    s.project.cards.push(
      cardDefSchema.parse({ id: 'oath', name: 'Oath', grant: { kind: 'chosen' }, domain: 'bulwark', type: 'ability', level: 1, recallCost: 0 }),
    );
    s.project.party.push(...projectSchema.parse({ ...project(), party: [blankSheet('kara', 'sentinel', { domainCards: ['oath'] })] }).party);
    const said = () =>
      validateProject(s.project, { characterContent: mergePack(STARTER_CHARACTERS, s.project) })
        .filter((problem) => problem.message.includes('oath'))
        .map((problem) => problem.severity);
    expect(said()).toEqual([]);

    expect(s.run(removeCard('oath'))).toBe(true);
    expect(s.project.cards).toEqual([]);
    // Kara still holds it: deleting a card does not reach into a sheet, and Check is where that shows.
    expect(said()).toEqual(['error']);
    s.undo();
    expect(said()).toEqual([]);
  });

  it("takes the copy back out, and the pack's card is the one played again, with the abilities on it", () => {
    const s = session();
    const packed = STARTER_CHARACTERS.cards.get('power-slash')!;
    const played = () => mergePack(STARTER_CHARACTERS, s.project).cards.get('power-slash')!;
    s.run(addCard(cardDefSchema.parse(packed)));
    s.run(updateCard('power-slash', { recallCost: 3 }));
    s.run(addAbility(abilitySchema.parse({ id: 'follow-through', name: 'Follow Through', source: { card: 'power-slash' } })));
    expect(played().recallCost).toBe(3);

    expect(s.run(removeCard('power-slash'))).toBe(true);
    expect(s.project.cards).toEqual([]);
    expect(played()).toBe(packed);
    // The ability stays, on the pack's card under the same id.
    expect(s.project.abilities.find((a) => a.id === 'follow-through')?.source).toEqual({ card: 'power-slash' });
    // Nothing left to take out is not an undo step.
    expect(s.run(removeCard('power-slash'))).toBe(false);

    s.undo();
    expect(played().recallCost).toBe(3);
    s.redo();
    expect(played()).toBe(packed);
  });

  it("edits a copy of the pack's card, which the project plays over the pack's until it is undone", () => {
    const s = session();
    const packed = STARTER_CHARACTERS.cards.get('power-slash')!;
    const played = () => mergePack(STARTER_CHARACTERS, s.project).cards.get('power-slash')!;

    expect(s.run(addCard(cardDefSchema.parse(packed)))).toBe(true);
    s.run(updateCard('power-slash', { recallCost: 3, level: 2 }));
    expect(played()).toMatchObject({ recallCost: 3, level: 2, domain: 'bulwark', name: 'Power Slash' });
    // The pack itself is never written: the copy is a copy.
    expect(packed).toMatchObject({ recallCost: 1, level: 1 });

    // A card the project already has is left where it is, and asking again is not an undo step.
    expect(s.run(addCard(cardDefSchema.parse(packed)))).toBe(false);
    expect(s.project.cards.filter((c) => c.id === 'power-slash')).toHaveLength(1);

    s.undo();
    s.undo();
    expect(s.project.cards).toEqual([]);
    expect(played()).toBe(packed);
  });

  it('coalesces keystrokes in one field and starts again on another', () => {
    const s = session();
    for (const text of ['S', 'Sh', 'Sho', 'Shout']) s.run(updateAbility('rally', { text }));
    expect(rally(s).text).toBe('Shout');

    s.run(updateAbility('rally', { name: 'Rally the Line' }));
    expect(rally(s).name).toBe('Rally the Line');

    // The name is its own step; undoing it leaves the typed text alone.
    s.undo();
    expect(rally(s).name).toBe('Rally');
    expect(rally(s).text).toBe('Shout');
    s.undo();
    expect(rally(s).text).toBe(RALLY.text);
  });

  it('replaces the script whole, and the card survives a round trip through the schema', () => {
    const s = session();
    s.run(
      updateAbility('rally', {
        effects: [
          { kind: 'run', hook: 'rally-the-line', args: { bonus: 2 } },
          { kind: 'damage', dice: 'same', half: true, target: { kind: 'adversaries', range: 'veryClose', except: 'target' } },
        ],
      }),
    );
    const parsed = projectSchema.parse(JSON.parse(JSON.stringify(s.project)));
    expect(parsed.abilities[0]!.effects).toEqual([
      { kind: 'run', hook: 'rally-the-line', args: { bonus: 2 } },
      { kind: 'damage', dice: 'same', half: true, target: { kind: 'adversaries', range: 'veryClose', except: 'target' } },
    ]);
  });
});
