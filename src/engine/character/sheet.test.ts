import { describe, it, expect } from 'vitest';
import { STARTER_CHARACTERS } from '../content/pack/starter';
import {
  UNARMED,
  attackProfile,
  blankSheet,
  defenderProfile,
  deriveCharacter,
  startingPools,
  type CharacterSheet,
} from './sheet';

// The pack the app ships. What these tests want is a class, an armour and a weapon that
// exist; which ones they are belongs to the pack, not to the engine.
const content = STARTER_CHARACTERS;

const sentinel = (overrides: Partial<CharacterSheet> = {}): CharacterSheet =>
  blankSheet('kara', 'sentinel', {
    name: 'Quim',
    traits: { agility: 0, strength: 2, finesse: 0, instinct: 1, presence: 1, knowledge: -1 },
    // Same thresholds and score as the armour this replaced (5/11, 3), so every derived
    // number below stays the literal it was.
    armorId: 'padded-coat',
    primaryWeaponId: 'longsword',
    ...overrides,
  });

describe('deriving a character', () => {
  it('takes Evasion and Hit Points from the class', () => {
    const klass = content.classes.get('sentinel')!;
    const { character, issues } = deriveCharacter(sentinel(), content);
    expect(issues).toEqual([]);
    expect(character.evasion).toBe(klass.startingEvasion);
    expect(character.hitPoints).toBe(klass.startingHitPoints);
    expect(character.stress).toBe(6);
  });

  it('adds the level to the armor thresholds and takes its Armor Score', () => {
    const { character } = deriveCharacter(sentinel({ level: 3 }), content);
    expect(character.thresholds).toEqual({ major: 8, severe: 14 });
    expect(character.armorScore).toBe(3);
  });

  it('falls back to the unarmoured formula with no armor', () => {
    const { character } = deriveCharacter(sentinel({ level: 4, armorId: undefined }), content);
    expect(character.thresholds).toEqual({ major: 4, severe: 8 });
    expect(character.armorScore).toBe(0);
  });

  it('applies flat bonuses from advancements', () => {
    const { character } = deriveCharacter(
      sentinel({ bonuses: { evasion: 2, hitPoints: 1, armorScore: 1, severeThreshold: 4 } }),
      content,
    );
    const klass = content.classes.get('sentinel')!;
    expect(character.evasion).toBe(klass.startingEvasion + 2);
    expect(character.hitPoints).toBe(klass.startingHitPoints + 1);
    expect(character.armorScore).toBe(4);
    expect(character.thresholds.severe).toBe(11 + 1 + 4);
  });

  it('caps Hit Points, Stress and Armor Score where the rules do', () => {
    const { character } = deriveCharacter(
      sentinel({ bonuses: { hitPoints: 99, stress: 99, armorScore: 99 } }),
      content,
    );
    expect(character.hitPoints).toBe(12);
    expect(character.stress).toBe(12);
    expect(character.armorScore).toBe(12);
  });

  it('reports an unknown content id instead of throwing, and stays playable', () => {
    const { character, issues } = deriveCharacter(
      sentinel({ classId: 'nope', armorId: 'nope', primaryWeaponId: 'nope', ancestryId: 'nope' }),
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
    const { character } = deriveCharacter(sentinel(), content);
    const profile = attackProfile(character);
    expect(profile).toMatchObject({ kind: 'pc', name: 'Longsword', range: 'melee', proficiency: 1 });
    // The longsword is a Strength weapon, and this character has Strength +2.
    expect(profile.modifier).toEqual({ count: 0, sides: 0, modifier: 2 });
    expect(profile.damage).toMatchObject({ count: 1, sides: 8 });
  });

  it('uses the trait the weapon names, not the best one', () => {
    const finesse = [...content.weapons.values()].find((w) => w.trait === 'finesse')!;
    const { character } = deriveCharacter(
      sentinel({ primaryWeaponId: finesse.id, traits: { ...sentinel().traits, finesse: 3 } }),
      content,
    );
    expect(attackProfile(character).modifier.modifier).toBe(3);
  });

  it('punches for Proficiency d4 with no weapon', () => {
    const { character } = deriveCharacter(
      sentinel({ primaryWeaponId: undefined, proficiency: 2 }),
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
    const { character } = deriveCharacter(sentinel({ secondaryWeaponId: secondary.id }), content);
    expect(attackProfile(character, 'secondary').name).toBe(secondary.name);
    expect(attackProfile(character, 'primary').name).toBe('Longsword');
  });

  it('describes how the character is attacked in turn', () => {
    const { character } = deriveCharacter(sentinel(), content);
    expect(defenderProfile(character)).toEqual({
      difficulty: character.evasion,
      thresholds: character.thresholds,
    });
  });
});

describe('starting pools', () => {
  it('opens empty, at the sizes the sheet derives', () => {
    const { character } = deriveCharacter(sentinel(), content);
    const pools = startingPools(character);
    expect(pools.hitPoints).toEqual({ max: character.hitPoints, marked: 0 });
    expect(pools.stress).toEqual({ max: 6, marked: 0 });
    expect(pools.armorSlots).toEqual({ max: 3, marked: 0 });
    expect(pools.good.value).toBe(2);
  });

  it('does not alias the derived character', () => {
    const { character } = deriveCharacter(sentinel(), content);
    const pools = startingPools(character);
    pools.good.value = 6;
    expect(character.good.value).toBe(2);
  });
});
