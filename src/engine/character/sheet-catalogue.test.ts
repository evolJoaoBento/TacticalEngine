import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importContentPack, type ContentPack } from '../content/pack/import';
import { attackProfile, blankSheet, deriveCharacter } from './sheet';

/**
 * The vendored catalogue, as content.
 *
 * These assertions are about the imported catalogue itself — how many of each kind it has,
 * the source's own tier tables, the breadth that lets a search find a dual-damage weapon,
 * and that every class and weapon in it yields a playable character. None of it is engine
 * behaviour, which lives in `sheet.test.ts` and reads the shipped pack instead.
 *
 * **This file is deleted with the catalogue.** It exists so that coverage of the import is
 * kept for as long as there is something to import, and so that the deletion is a file on a
 * list rather than assertions unpicked from an engine test.
 */

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const read = (name: string): unknown[] =>
  JSON.parse(readFileSync(`${repoRoot}tools/srd-sources/daggersearch/core/${name}.json`, 'utf8'));

const imported = importContentPack({
  weapons: read('weapons'),
  armors: read('armors'),
  classes: read('classes'),
  ancestries: read('ancestries'),
  communities: read('communities'),
});
const content: ContentPack = imported.content;

describe('the vendored character content', () => {
  it('imports every file with no issues', () => {
    expect(imported.issues).toEqual([]);
    expect(content.classes.size).toBe(9);
    expect(content.ancestries.size).toBe(18);
    expect(content.communities.size).toBe(9);
    expect(content.armors.size).toBe(34);
    expect(content.weapons.size).toBe(192);
  });

  it('gives content short, stable ids rather than the source prefixes', () => {
    expect(content.classes.has('guardian')).toBe(true);
    expect(content.weapons.has('broadsword')).toBe(true);
    expect(content.armors.has('gambeson-armor')).toBe(true);
  });

  it('reads a class the rules can use', () => {
    const klass = content.classes.get('guardian')!;
    expect(klass.name).toBe('Guardian');
    expect(klass.startingEvasion).toBeGreaterThan(0);
    expect(klass.startingHitPoints).toBeGreaterThan(0);
    expect(klass.domains.length).toBeGreaterThan(0);
    expect(klass.signatureFeature?.name).toBeTruthy();
  });

  it('reads a weapon as a rollable attack', () => {
    const sword = content.weapons.get('broadsword')!;
    expect(sword).toMatchObject({ trait: 'agility', range: 'melee', burden: 'oneHanded', tier: 1 });
    // The SRD tier-1 table really is "d8 phy", with no modifier.
    expect(sword.damage).toEqual({ count: 1, sides: 8, modifier: 0, types: ['physical'] });
    expect(sword.features[0]!.name).toBe('Reliable');
  });

  it('carries the damage modifier that higher tiers add', () => {
    const improved = content.weapons.get('improved-broadsword')!;
    expect(improved.damage).toMatchObject({ count: 1, sides: 8, modifier: 3 });
  });

  it('carries a weapon that deals either damage type as both', () => {
    const either = [...content.weapons.values()].find((w) => (w.damage.types?.length ?? 0) > 1);
    expect(either?.damage.types).toEqual(['physical', 'magic']);
  });

  it('reads armor thresholds and score', () => {
    expect(content.armors.get('gambeson-armor')).toMatchObject({
      baseThresholds: { major: 5, severe: 11 },
      baseScore: 3,
    });
  });
});

describe('every class and every weapon is usable', () => {
  it('derives a playable character for each of the nine classes', () => {
    for (const klass of content.classes.values()) {
      const { character, issues } = deriveCharacter(blankSheet('x', klass.id), content);
      expect(issues).toEqual([]);
      expect(character.evasion).toBeGreaterThan(0);
      expect(character.hitPoints).toBeGreaterThan(0);
    }
  });

  it('builds an attack profile for every weapon in the book', () => {
    for (const weapon of content.weapons.values()) {
      const { character } = deriveCharacter(
        blankSheet('x', 'warrior', { primaryWeaponId: weapon.id }),
        content,
      );
      const profile = attackProfile(character);
      expect(profile.damage.sides).toBeGreaterThan(0);
      expect(profile.range).not.toBe('outOfRange');
    }
  });
});
