import { describe, it, expect } from 'vitest';
import { STARTER_ABILITIES, STARTER_CHARACTERS } from './pack/starter';
import { abilitiesFor, abilitySchema, isScripted, loadoutOf, vaultOf, LOADOUT_LIMIT, type AbilityDef } from './abilities';
import { blankSheet, deriveCharacter, type CharacterSheet } from '../character/sheet';
import { levelUp } from '../character/progression';

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
    const parsed = abilitySchema.parse({ id: 'x', name: 'X', source: { kind: 'domainCard', card: 'power-slash' } });
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
    abilitySchema.parse({ id: 'own', name: 'Own', source: { kind: 'granted', characters: ['kara'] } }),
    abilitySchema.parse({ id: 'theirs', name: 'Theirs', source: { kind: 'granted', characters: ['mira'] } }),
    // The pack ships no classHope and no specialization ability, though every
    // starter subclass prints all three stages. This array exists to supply the
    // sources the content does not, which is why these two are written here.
    abilitySchema.parse({ id: 'sentinel-second-wind', name: 'Second Wind', source: { kind: 'classHope', classId: 'sentinel' } }),
    abilitySchema.parse({ id: 'shieldbearer-iron', name: 'Iron Will', source: { kind: 'subclass', subclassId: 'shieldbearer', stage: 'foundation' } }),
    abilitySchema.parse({ id: 'shieldbearer-partners', name: 'Partners', source: { kind: 'subclass', subclassId: 'shieldbearer', stage: 'specialization' } }),
  ];

  it('orders class, Hope, subclass by stage reached, then the loadout', () => {
    const ids = abilitiesFor(derive(kara()), [...STARTER_ABILITIES, ...custom]).map((a) => a.id);
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
    // The sixth card carries an ability on purpose. Three of the pack's cards ship as
    // text only, and one of those in this slot would be absent from the list whether
    // the vault worked or not — passing for two reasons, and still passing if the
    // vault stopped excluding anything.
    const six = derive(kara({ domainCards: ['power-slash', 'iron-stance', 'shield-wall', 'rallying-cry', 'unbroken', 'backstab'] }));
    const ids = abilitiesFor(six, [...STARTER_ABILITIES, ...custom]).map((a) => a.id);
    expect(ids).not.toContain('backstab');
    expect(ids).not.toContain('shieldbearer-partners');
    expect(ids).not.toContain('theirs');
    // Both of these carry an ability, which is what makes them comparable here: a
    // card the pack ships as text only is held and silent, so it never appears in
    // this list at all. `rallying-cry` is one of those, and asking where it sits
    // reads -1 rather than an order.
    expect(ids.indexOf('unbroken')).toBeGreaterThan(ids.indexOf('shield-wall'));
  });
});
