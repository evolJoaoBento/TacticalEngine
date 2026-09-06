import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importCharacterContent } from './srd/daggersearch';
import { SRD_ABILITIES } from './srd/abilities';
import { abilitiesFor, abilitySchema, isScripted, loadoutOf, vaultOf, LOADOUT_LIMIT, type AbilityDef } from './abilities';
import { blankSheet, deriveCharacter, type CharacterSheet } from '../character/sheet';
import { levelUp } from '../character/progression';

/**
 * Abilities as content: the schema's defaults, which of a character's cards
 * count, and that every scripted SRD card names a card the SRD content has.
 */

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const read = (name: string): unknown[] =>
  JSON.parse(readFileSync(`${repoRoot}tools/srd-sources/daggersearch/core/${name}.json`, 'utf8'));
const content = importCharacterContent({
  weapons: read('weapons'),
  armors: read('armors'),
  classes: read('classes'),
  ancestries: read('ancestries'),
  communities: read('communities'),
  subclasses: read('subclasses'),
  domainCards: read('domain-cards'),
}).content;

const kara = (overrides: Partial<CharacterSheet> = {}): CharacterSheet =>
  blankSheet('kara', 'guardian', {
    subclassId: 'stalwart',
    domainCards: ['bare-bones', 'get-back-up'],
    experiences: [{ name: 'Held the line', modifier: 2 }],
    ...overrides,
  });
const derive = (sheet: CharacterSheet) => deriveCharacter(sheet, content).character;

describe('the schema', () => {
  it('fills in the defaults a plain card needs', () => {
    const parsed = abilitySchema.parse({ id: 'x', name: 'X', source: { kind: 'domainCard', card: 'bare-bones' } });
    expect(parsed).toMatchObject({ kind: 'action', cost: {}, target: { kind: 'none', range: 'melee' }, effects: [], modifiers: [], action: true, inCombatOnly: false });
    expect(isScripted(parsed)).toBe(false);
  });

  it('ships a library whose every entry parses and names real content', () => {
    for (const ability of SRD_ABILITIES) {
      expect(() => abilitySchema.parse(ability)).not.toThrow();
      const source = ability.source;
      if (source.kind === 'domainCard') expect(content.domainCards.has(source.card), ability.id).toBe(true);
      if (source.kind === 'classHope' || source.kind === 'classFeature') expect(content.classes.has(source.classId), ability.id).toBe(true);
      if (source.kind === 'subclass') expect(content.subclasses.has(source.subclassId), ability.id).toBe(true);
    }
    expect(new Set(SRD_ABILITIES.map((a) => a.id)).size).toBe(SRD_ABILITIES.length);
  });
});

describe('the loadout', () => {
  it('is the first five held unless the sheet says otherwise, and drops cards no longer held', () => {
    const two = derive(kara());
    expect(loadoutOf(two)).toEqual(['bare-bones', 'get-back-up']);
    expect(vaultOf(two)).toEqual([]);
    const six = derive(kara({ domainCards: ['bare-bones', 'get-back-up', 'forceful-push', 'i-am-your-shield', 'whirlwind', 'not-good-enough'] }));
    expect(loadoutOf(six)).toHaveLength(LOADOUT_LIMIT);
    expect(vaultOf(six)).toEqual(['not-good-enough']);
    const chosen = derive(kara({ domainCards: ['bare-bones', 'get-back-up', 'forceful-push'], loadout: ['forceful-push', 'reckless', 'bare-bones'] }));
    expect(loadoutOf(chosen)).toEqual(['forceful-push', 'bare-bones']);
    expect(vaultOf(chosen)).toEqual(['get-back-up']);
  });

  it('includes the card a level grants', () => {
    const levelled = levelUp(kara(), content, {
      advancements: [{ kind: 'hitPoint' }, { kind: 'stress' }],
      domainCard: 'forceful-push',
      experience: { name: 'Vault-born', modifier: 2 },
    });
    expect(levelled.issues).toEqual([]);
    expect(loadoutOf(derive(levelled.sheet))).toEqual(['bare-bones', 'get-back-up', 'forceful-push']);
  });
});

describe('abilitiesFor', () => {
  const custom: AbilityDef[] = [
    abilitySchema.parse({ id: 'own', name: 'Own', source: { kind: 'granted', characters: ['kara'] } }),
    abilitySchema.parse({ id: 'theirs', name: 'Theirs', source: { kind: 'granted', characters: ['mira'] } }),
    abilitySchema.parse({ id: 'stalwart-iron', name: 'Iron Will', source: { kind: 'subclass', subclassId: 'stalwart', stage: 'foundation' } }),
    abilitySchema.parse({ id: 'stalwart-partners', name: 'Partners', source: { kind: 'subclass', subclassId: 'stalwart', stage: 'specialization' } }),
  ];

  it('orders class, Hope, subclass by stage reached, then the loadout', () => {
    const ids = abilitiesFor(derive(kara()), [...SRD_ABILITIES, ...custom]).map((a) => a.id);
    expect(ids).toEqual(['guardian-frontline-tank', 'stalwart-unwavering', 'stalwart-iron-will', 'stalwart-iron', 'bare-bones', 'get-back-up', 'own']);
  });

  it('leaves out vaulted cards and unreached subclass stages', () => {
    const six = derive(kara({ domainCards: ['bare-bones', 'get-back-up', 'forceful-push', 'i-am-your-shield', 'whirlwind', 'not-good-enough'] }));
    const ids = abilitiesFor(six, [...SRD_ABILITIES, ...custom]).map((a) => a.id);
    expect(ids).not.toContain('not-good-enough');
    expect(ids).not.toContain('stalwart-partners');
    expect(ids).not.toContain('theirs');
    expect(ids.indexOf('whirlwind')).toBeGreaterThan(ids.indexOf('forceful-push'));
  });
});

describe('where the words come from', () => {
  it('ships no card text of its own: a domain card\'s words are read from the vendored SRD content', () => {
    for (const ability of SRD_ABILITIES) {
      if (ability.source.kind === 'domainCard') expect(ability.text, ability.id).toBe('');
    }
    // A grimoire's spells are the card's named features, so a spell finds its own words.
    const ava = content.domainCards.get('book-of-ava')!;
    expect(ava.features.map((f) => f.name)).toEqual(['Power Push', "Tava's Armor", 'Ice Spike']);
    expect(ava.features[0]!.text.startsWith('Make a Spellcast Roll against a target within Melee range.')).toBe(true);
    expect(content.domainCards.get('bolt-beacon')!.features).toHaveLength(1);
  });
});
