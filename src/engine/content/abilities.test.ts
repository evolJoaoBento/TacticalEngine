import { describe, it, expect } from 'vitest';
import { STARTER_ABILITIES, STARTER_CHARACTERS } from './pack/starter';
import {
  abilitiesFor,
  abilitySchema,
  isScripted,
  isStatBlockFeature,
  loadoutOf,
  statBlocksOf,
  vaultOf,
  LOADOUT_LIMIT,
  type AbilityDef,
} from './abilities';
import { blankSheet, deriveCharacter, type CharacterSheet } from '../character/sheet';
import { levelUp } from '../character/progression';
import { mergePack } from './pack/import';
import { cardDefSchema } from './pack/schema';

/**
 * Abilities as content: the schema's defaults, which of a character's cards
 * count, and the order a sheet lists what a character has.
 *
 * What the shipped catalogue itself contains is `abilities-catalogue.test.ts`,
 * which leaves when the catalogue does.
 */

// The pack the app ships. Which class and which cards these are belongs to the
// pack; what is being checked here is the engine reading any of them.
const content = STARTER_CHARACTERS;

const kara = (overrides: Partial<CharacterSheet> = {}): CharacterSheet =>
  blankSheet('kara', 'sentinel', {
    subclassId: 'shieldbearer',
    domainCards: ['power-slash', 'iron-stance'],
    experiences: [{ name: 'Held the line', modifier: 2 }],
    ...overrides,
  });
const derive = (sheet: CharacterSheet) => deriveCharacter(sheet, content).character;

describe('the schema', () => {
  it('fills in the defaults a plain card needs', () => {
    const parsed = abilitySchema.parse({ id: 'x', name: 'X', source: { card: 'power-slash' } });
    expect(parsed).toMatchObject({ kind: 'action', cost: {}, target: { kind: 'none', range: 'melee' }, effects: [], modifiers: [], action: true, inCombatOnly: false });
    expect(isScripted(parsed)).toBe(false);
  });
});

describe('the loadout', () => {
  it('is the first five held unless the sheet says otherwise, and drops cards no longer held', () => {
    const two = derive(kara());
    expect(loadoutOf(two)).toEqual(['power-slash', 'iron-stance']);
    expect(vaultOf(two)).toEqual([]);
    // Five bulwark cards and a shadow one. Held cards are not domain-gated -- only a
    // card a LEVEL grants is -- so the sixth is what lands in the vault.
    const six = derive(kara({ domainCards: ['power-slash', 'iron-stance', 'shield-wall', 'rallying-cry', 'unbroken', 'smoke-step'] }));
    expect(loadoutOf(six)).toHaveLength(LOADOUT_LIMIT);
    expect(vaultOf(six)).toEqual(['smoke-step']);
    // A loadout naming a card that is not held: it is dropped rather than conjured.
    const chosen = derive(kara({ domainCards: ['power-slash', 'iron-stance', 'shield-wall'], loadout: ['shield-wall', 'quick-hands', 'power-slash'] }));
    expect(loadoutOf(chosen)).toEqual(['shield-wall', 'power-slash']);
    expect(vaultOf(chosen)).toEqual(['iron-stance']);
  });

  it('includes the card a level grants', () => {
    const levelled = levelUp(kara(), content, {
      advancements: [{ kind: 'hitPoint' }, { kind: 'stress' }],
      // Bulwark, level 2, and not already held: what `cardAllowed` asks of a grant.
      domainCard: 'rallying-cry',
      experience: { name: 'Vault-born', modifier: 2 },
    });
    expect(levelled.issues).toEqual([]);
    expect(loadoutOf(derive(levelled.sheet))).toEqual(['power-slash', 'iron-stance', 'rallying-cry']);
  });
});

describe('abilitiesFor', () => {
  const custom: AbilityDef[] = [
    abilitySchema.parse({ id: 'own', name: 'Own', source: { card: 'own' } }),
    abilitySchema.parse({ id: 'theirs', name: 'Theirs', source: { card: 'theirs' } }),
    // The pack ships no second class card and no specialization ability, though
    // every starter subclass prints all three stages. `CUSTOM_CARDS` says how each
    // of these came to be in play; this is what is on them.
    abilitySchema.parse({ id: 'sentinel-second-wind', name: 'Second Wind', source: { card: 'sentinel-second-wind' } }),
    abilitySchema.parse({ id: 'shieldbearer-iron', name: 'Iron Will', source: { card: 'shieldbearer-iron' } }),
    abilitySchema.parse({ id: 'shieldbearer-partners', name: 'Partners', source: { card: 'shieldbearer-partners' } }),
  ];

  /** How each ability above came to be in play: two handed over, a class card, two subclass cards. */
  const CUSTOM_CARDS = [
    cardDefSchema.parse({ id: 'own', name: 'Own', grant: { kind: 'given', characters: ['kara'] } }),
    cardDefSchema.parse({ id: 'theirs', name: 'Theirs', grant: { kind: 'given', characters: ['mira'] } }),
    cardDefSchema.parse({ id: 'sentinel-second-wind', name: 'Second Wind', grant: { kind: 'class', classId: 'sentinel' } }),
    cardDefSchema.parse({ id: 'shieldbearer-iron', name: 'Iron Will', grant: { kind: 'subclass', subclassId: 'shieldbearer', stage: 'foundation' } }),
    cardDefSchema.parse({ id: 'shieldbearer-partners', name: 'Partners', grant: { kind: 'subclass', subclassId: 'shieldbearer', stage: 'specialization' } }),
  ];
  const withCards = mergePack(content, { cards: CUSTOM_CARDS });
  const deriveWith = (sheet: CharacterSheet) => deriveCharacter(sheet, withCards).character;

  it('orders class, Light, subclass by stage reached, then the loadout', () => {
    const ids = abilitiesFor(deriveWith(kara()), [...STARTER_ABILITIES, ...custom]).map((a) => a.id);
    expect(ids).toEqual([
      'sentinel-drilled',
      'sentinel-hold-the-line',
      'sentinel-second-wind',
      'shieldbearer-set-feet',
      'shieldbearer-iron',
      'power-slash',
      'iron-stance',
      'own',
    ]);
  });

  it('leaves out vaulted cards and unreached subclass stages', () => {
    // The sixth card carries an ability on purpose. A card the pack ships as text only
    // (`cut-purse-strings`, now) in this slot would be absent from the list whether
    // the vault worked or not — passing for two reasons, and still passing if the
    // vault stopped excluding anything.
    const six = deriveWith(kara({ domainCards: ['power-slash', 'iron-stance', 'shield-wall', 'rallying-cry', 'unbroken', 'backstab'] }));
    const ids = abilitiesFor(six, [...STARTER_ABILITIES, ...custom]).map((a) => a.id);
    expect(ids).not.toContain('backstab');
    expect(ids).not.toContain('shieldbearer-partners');
    expect(ids).not.toContain('theirs');
    // Both of these carry an ability, which is what makes them comparable here: a
    // card the pack ships as text only is held and silent, so it never appears in
    // this list at all, and asking where it sits reads -1 rather than an order.
    expect(ids.indexOf('unbroken')).toBeGreaterThan(ids.indexOf('shield-wall'));
  });

  it('leaves out a card printed on a stat block, even one named for the character', () => {
    // A block that happens to share Kara's id: `adversary` names blocks, never characters, so the
    // card is nobody's hand however the ids fall.
    const printed = cardDefSchema.parse({ id: 'claws', name: 'Claws', grant: { kind: 'adversary', adversaries: ['kara'] } });
    const claws = abilitySchema.parse({ id: 'claws', name: 'Claws', source: { card: 'claws' } });
    const character = deriveCharacter(kara(), mergePack(content, { cards: [printed] })).character;
    expect(character.granted.map((card) => card.id)).not.toContain('claws');
    expect(abilitiesFor(character, [claws])).toEqual([]);
  });
});

describe('a stat block\'s feature', () => {
  it('is an ability on a card printed on a block, and reads its blocks off that card', () => {
    const cards = new Map([
      ['claws', cardDefSchema.parse({ id: 'claws', name: 'Claws', grant: { kind: 'adversary', adversaries: ['husk', 'ghoul'] } })],
      ['own', cardDefSchema.parse({ id: 'own', name: 'Own', grant: { kind: 'given', characters: ['kara'] } })],
    ]);
    const on = (card: string) => abilitySchema.parse({ id: card, name: card, source: { card } });
    expect(statBlocksOf(on('claws'), cards)).toEqual(['husk', 'ghoul']);
    expect(isStatBlockFeature(on('claws'), cards)).toBe(true);
    // A card somebody holds is no block's; nor is a card nothing defines.
    expect(statBlocksOf(on('own'), cards)).toBeNull();
    expect(isStatBlockFeature(on('missing'), cards)).toBe(false);
  });
});
