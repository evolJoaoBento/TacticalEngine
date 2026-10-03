/**
 * The traits a new character shares out (`new-character.ts`): the SRD's starting spread, +2 +1 +1 +0
 * +0 −1, one to each trait, starting where the class leans and traded about by the player, and the
 * sheet New Game makes taking the traits as they were left.
 */

import { describe, expect, it } from 'vitest';
import { GEAR, SPREADS, STARTING_SPREAD, TRAIT_ORDER, TRAIT_VERBS, isArmor, isStartingSpread, keyTrait, sheetFor, startingArmors, startingWeapons, suggestedTraits, swapTraits } from './new-character';
import { EQUIPMENT } from '../engine/content/equipment/catalogue';
import { catalogueCard } from './gear';

const hero = { name: 'Ash', ancestryId: 'dwarf', model: 'quim', communityId: 'ridgeborne', classId: 'guardian', subclassId: 'stalwart', domainCards: ['bare-bones', 'get-back-up'] };

describe('the starting spread', () => {
  it('is what every class suggests, laid its own way', () => {
    for (const [classId, traits] of Object.entries(SPREADS)) expect(isStartingSpread(traits), classId).toBe(true);
    expect(suggestedTraits('guardian')).toEqual(SPREADS.guardian);
    // A class the table does not name gets the spread in trait order.
    const unknown = suggestedTraits('duelist');
    expect(TRAIT_ORDER.map((trait) => unknown[trait])).toEqual([...STARTING_SPREAD]);
    expect(suggestedTraits(undefined)).toEqual(unknown);
  });

  it('is not two of one number, a missing one, or one out of range', () => {
    expect(isStartingSpread({ ...SPREADS.guardian!, agility: 2 })).toBe(false);
    expect(isStartingSpread({ agility: 0, strength: 0, finesse: 0, instinct: 0, presence: 0, knowledge: 0 })).toBe(false);
    expect(isStartingSpread({ ...SPREADS.guardian!, finesse: -2, instinct: 1 })).toBe(false);
  });

  it('stays the spread however two traits are traded, and a trade back undoes it', () => {
    let traits = suggestedTraits('guardian');
    for (const [a, b] of [['strength', 'knowledge'], ['finesse', 'presence'], ['agility', 'agility'], ['instinct', 'strength']] as const) {
      traits = swapTraits(traits, a, b);
      expect(isStartingSpread(traits)).toBe(true);
    }
    const once = swapTraits(SPREADS.guardian!, 'strength', 'knowledge');
    expect(once.strength).toBe(SPREADS.guardian!.knowledge);
    expect(once.knowledge).toBe(SPREADS.guardian!.strength);
    expect(swapTraits(once, 'strength', 'knowledge')).toEqual(SPREADS.guardian);
  });

  it('marks the trait that matters most: the one spells are cast with, or where the class leans', () => {
    expect(keyTrait('sorcerer', 'instinct')).toBe('instinct');
    expect(keyTrait('wizard', 'knowledge')).toBe('knowledge');
    // A class that casts nothing: where its suggestion puts the +2.
    expect(keyTrait('guardian')).toBe('strength');
    expect(keyTrait('warrior')).toBe('agility');
    // And each caster's suggestion already puts its +2 on the trait it casts with.
    for (const [classId, trait] of [['bard', 'presence'], ['druid', 'instinct'], ['ranger', 'agility'], ['rogue', 'finesse'], ['seraph', 'strength'], ['sorcerer', 'instinct'], ['wizard', 'knowledge']] as const) {
      expect(suggestedTraits(classId)[trait], classId).toBe(2);
    }
  });

  it('names three things each trait is rolled for', () => {
    for (const trait of TRAIT_ORDER) expect(TRAIT_VERBS[trait]).toHaveLength(3);
  });
});

describe('the sheet New Game makes', () => {
  it('takes the traits as the player left them', () => {
    const traits = swapTraits(SPREADS.guardian!, 'strength', 'knowledge');
    expect(sheetFor({ ...hero, traits }).traits).toEqual(traits);
  });

  it('takes the class’s suggestion when none were shared out, or they are not the spread', () => {
    expect(sheetFor(hero).traits).toEqual(SPREADS.guardian);
    expect(sheetFor({ ...hero, traits: { agility: 2, strength: 2, finesse: 2, instinct: 2, presence: 2, knowledge: 2 } }).traits).toEqual(SPREADS.guardian);
  });
});

describe('the equipment a new character starts with', () => {
  const slotOf = (id: string) => EQUIPMENT.weapons.find((weapon) => weapon.id === id)!.slot;

  it('is a tier-1 primary weapon - a magic one only for a character who casts - the class’s suggestion first', () => {
    const fighter = startingWeapons('guardian', false);
    expect(fighter[0]).toBe(GEAR.guardian!.primary);
    expect(fighter.every((id) => slotOf(id) === 'primaryPhysical')).toBe(true);
    const caster = startingWeapons('wizard', true);
    expect(caster[0]).toBe(GEAR.wizard!.primary);
    expect(caster.some((id) => slotOf(id) === 'primaryMagic')).toBe(true);
    expect(caster.length).toBeGreaterThan(fighter.length);
    expect(new Set(caster).size).toBe(caster.length);
    for (const id of caster) expect(EQUIPMENT.weapons.find((weapon) => weapon.id === id)!.tier).toBe(1);
  });

  it('is tier-1 armour, the class’s suggestion first', () => {
    const armors = startingArmors('guardian');
    expect(armors[0]).toBe(GEAR.guardian!.armor);
    expect(armors.every(isArmor)).toBe(true);
    expect(isArmor(GEAR.guardian!.primary)).toBe(false);
  });

  it('is on the sheet as chosen, and the class’s second weapon only goes with a first that leaves a hand free', () => {
    const bard = { name: 'Lyra', ancestryId: 'elf', model: 'violet', communityId: 'highborne', classId: 'bard', subclassId: 'troubadour', domainCards: [] };
    // As suggested: the rapier, and the small dagger beside it.
    expect(sheetFor(bard)).toMatchObject({ primaryWeaponId: GEAR.bard!.primary, secondaryWeaponId: GEAR.bard!.secondary, armorId: GEAR.bard!.armor });
    // A greatsword takes both hands: no dagger.
    const greatsword = sheetFor({ ...bard, primaryWeaponId: 'primary-greatsword', armorId: 'armor-leather-armor' });
    expect(greatsword).toMatchObject({ primaryWeaponId: 'primary-greatsword', armorId: 'armor-leather-armor' });
    expect(greatsword.secondaryWeaponId).toBeUndefined();
    // A broadsword leaves one free: the dagger stays.
    expect(sheetFor({ ...bard, primaryWeaponId: 'primary-broadsword' }).secondaryWeaponId).toBe(GEAR.bard!.secondary);
  });

  it('is drawn as the catalogue’s own card', () => {
    expect(catalogueCard('primary-battleaxe')).toMatchObject({ name: 'Battleaxe', kind: 'weapon' });
    expect(catalogueCard('armor-chainmail-armor')).toMatchObject({ kind: 'armor' });
    expect(catalogueCard('nothing-at-all')).toBeNull();
  });
});

