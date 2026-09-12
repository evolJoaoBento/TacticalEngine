import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importContentPack, type ContentPack } from '../content/pack/import';
import {
  UNARMED,
  attackProfile,
  blankSheet,
  defenderProfile,
  deriveCharacter,
  startingPools,
  type CharacterSheet,
} from './sheet';

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

const guardian = (overrides: Partial<CharacterSheet> = {}): CharacterSheet =>
  blankSheet('kara', 'guardian', {
    name: 'Kara',
    traits: { agility: 0, strength: 2, finesse: 0, instinct: 1, presence: 1, knowledge: -1 },
    armorId: 'gambeson-armor',
    primaryWeaponId: 'broadsword',
    ...overrides,
  });

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

describe('deriving a character', () => {
  it('takes Evasion and Hit Points from the class', () => {
    const klass = content.classes.get('guardian')!;
    const { character, issues } = deriveCharacter(guardian(), content);
    expect(issues).toEqual([]);
    expect(character.evasion).toBe(klass.startingEvasion);
    expect(character.hitPoints).toBe(klass.startingHitPoints);
    expect(character.stress).toBe(6);
  });

  it('adds the level to the armor thresholds and takes its Armor Score', () => {
    const { character } = deriveCharacter(guardian({ level: 3 }), content);
    expect(character.thresholds).toEqual({ major: 8, severe: 14 });
    expect(character.armorScore).toBe(3);
  });

  it('falls back to the unarmoured formula with no armor', () => {
    const { character } = deriveCharacter(guardian({ level: 4, armorId: undefined }), content);
    expect(character.thresholds).toEqual({ major: 4, severe: 8 });
    expect(character.armorScore).toBe(0);
  });

  it('applies flat bonuses from advancements', () => {
    const { character } = deriveCharacter(
      guardian({ bonuses: { evasion: 2, hitPoints: 1, armorScore: 1, severeThreshold: 4 } }),
      content,
    );
    const klass = content.classes.get('guardian')!;
    expect(character.evasion).toBe(klass.startingEvasion + 2);
    expect(character.hitPoints).toBe(klass.startingHitPoints + 1);
    expect(character.armorScore).toBe(4);
    expect(character.thresholds.severe).toBe(11 + 1 + 4);
  });

  it('caps Hit Points, Stress and Armor Score where the SRD does', () => {
    const { character } = deriveCharacter(
      guardian({ bonuses: { hitPoints: 99, stress: 99, armorScore: 99 } }),
      content,
    );
    expect(character.hitPoints).toBe(12);
    expect(character.stress).toBe(12);
    expect(character.armorScore).toBe(12);
  });

  it('reports an unknown content id instead of throwing, and stays playable', () => {
    const { character, issues } = deriveCharacter(
      guardian({ classId: 'nope', armorId: 'nope', primaryWeaponId: 'nope', ancestryId: 'nope' }),
      content,
    );
    expect(issues.map((i) => i.field).sort()).toEqual([
      'ancestry',
      'armor',
      'class',
      'primaryWeapon',
    ]);
    // Still a usable character: unarmoured, unarmed, on the defaults.
    expect(character.armorScore).toBe(0);
    expect(character.primaryWeapon).toBeUndefined();
    expect(attackProfile(character).name).toBe('Unarmed');
  });
});

describe('turning a sheet into an attack', () => {
  it('rolls the weapon trait and uses its range and dice', () => {
    const { character } = deriveCharacter(guardian(), content);
    const profile = attackProfile(character);
    expect(profile).toMatchObject({ kind: 'pc', name: 'Broadsword', range: 'melee', proficiency: 1 });
    // Broadsword is an Agility weapon, and this character has Agility +0.
    expect(profile.modifier).toEqual({ count: 0, sides: 0, modifier: 0 });
    expect(profile.damage).toMatchObject({ count: 1, sides: 8 });
  });

  it('uses the trait the weapon names, not the best one', () => {
    const finesse = [...content.weapons.values()].find((w) => w.trait === 'finesse')!;
    const { character } = deriveCharacter(
      guardian({ primaryWeaponId: finesse.id, traits: { ...guardian().traits, finesse: 3 } }),
      content,
    );
    expect(attackProfile(character).modifier.modifier).toBe(3);
  });

  it('punches for Proficiency d4 with no weapon', () => {
    const { character } = deriveCharacter(
      guardian({ primaryWeaponId: undefined, proficiency: 2 }),
      content,
    );
    const profile = attackProfile(character);
    expect(profile.damage).toEqual(UNARMED.damage);
    expect(profile.proficiency).toBe(2);
    // Unarmed uses Strength here, and this character has +2.
    expect(profile.modifier.modifier).toBe(2);
  });

  it('offers a secondary weapon separately', () => {
    const secondary = [...content.weapons.values()].find((w) => w.slot === 'secondary')!;
    const { character } = deriveCharacter(guardian({ secondaryWeaponId: secondary.id }), content);
    expect(attackProfile(character, 'secondary').name).toBe(secondary.name);
    expect(attackProfile(character, 'primary').name).toBe('Broadsword');
  });

  it('describes how the character is attacked in turn', () => {
    const { character } = deriveCharacter(guardian(), content);
    expect(defenderProfile(character)).toEqual({
      difficulty: character.evasion,
      thresholds: character.thresholds,
    });
  });
});

describe('starting pools', () => {
  it('opens empty, at the sizes the sheet derives', () => {
    const { character } = deriveCharacter(guardian(), content);
    const pools = startingPools(character);
    expect(pools.hitPoints).toEqual({ max: character.hitPoints, marked: 0 });
    expect(pools.stress).toEqual({ max: 6, marked: 0 });
    expect(pools.armorSlots).toEqual({ max: 3, marked: 0 });
    expect(pools.hope.value).toBe(2);
  });

  it('does not alias the derived character', () => {
    const { character } = deriveCharacter(guardian(), content);
    const pools = startingPools(character);
    pools.hope.value = 6;
    expect(character.hope.value).toBe(2);
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
