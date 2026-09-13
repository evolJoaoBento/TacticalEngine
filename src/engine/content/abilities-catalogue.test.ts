import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importContentPack } from './pack/import';
import { SRD_ABILITIES } from './srd/abilities';
import { abilitySchema } from './abilities';

/**
 * The vendored catalogue's abilities, as content.
 *
 * Two claims, neither about the engine: that every entry in the shipped library parses and
 * names content the catalogue actually has, and that a domain card carries no text of its own
 * because its words are read from the vendored source — a grimoire's spells being the card's
 * own named features.
 *
 * **This file is deleted with the catalogue.** The engine's side of abilities — the schema's
 * defaults, which cards count, the order a sheet lists them — is `abilities.test.ts`, and it
 * reads the pack the app ships.
 */

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const read = (name: string): unknown[] =>
  JSON.parse(readFileSync(`${repoRoot}tools/srd-sources/daggersearch/core/${name}.json`, 'utf8'));
const content = importContentPack({
  weapons: read('weapons'),
  armors: read('armors'),
  classes: read('classes'),
  ancestries: read('ancestries'),
  communities: read('communities'),
  subclasses: read('subclasses'),
  domainCards: read('domain-cards'),
}).content;

describe('the shipped library', () => {
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
