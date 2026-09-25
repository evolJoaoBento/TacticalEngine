/**
 * What the binder's gear pages show: the three places a character carries gear, each with the card
 * in it or none, and the party's pack as cards (`ui/GearBinder.tsx` draws them).
 *
 * Every carried thing is a card, whether the catalogue has a picture for it or not: a card says what
 * the thing is from its own numbers - a weapon's trait, range, damage and hands, armour's thresholds
 * and score - so the engine's own starter gear, which has no picture, reads the same way the
 * catalogue's does. The picture, when there is one, is only its `card` file; which files exist is
 * the UI's business (`ui/equipment-art.ts`).
 */

import type { ItemDef, ItemKind } from '../engine/content/items';
import type { ArmorDef, WeaponDef } from '../engine/content/pack/import';
import { itemOf } from '../engine/content/equipment/catalogue';
import { itemForGear, type GearSlot } from './equip';
import { characterContentFor } from './room';
import type { DemoScene } from './demo-scene';

/** The three places, in the order a sheet lists them, and what each is called on its sleeve. */
export const GEAR_SLOTS: readonly { slot: GearSlot; label: string }[] = [
  { slot: 'primary', label: 'Primary weapon' },
  { slot: 'secondary', label: 'Secondary weapon' },
  { slot: 'armor', label: 'Armor' },
];

/** One of the boxes along a card's middle: what it says, and the small print under it. */
export interface CardStat {
  text: string;
  caption?: string;
}

/** A card, as the binder and a shop draw it. */
export interface GearCard {
  /** The item it is, or - for starting gear no item stands for - the weapon or armour itself. */
  id: string;
  name: string;
  /** The banner across it: Weapon, Secondary Weapon, Armor, Consumable, Item, Key. */
  banner: string;
  kind: ItemKind;
  stats: CardStat[];
  /** A weapon's or armour's feature, named; an item's text is `text`. */
  feature: { name: string; text: string } | null;
  text: string;
  tier?: number;
  /** Its picture's file, when it has one. */
  card?: string;
  /** Which slot it goes in, when it is worn at all. */
  fits: GearSlot | null;
}

/** A card in the pack: how many, what one fetches, and whether it can be used. */
export interface CarriedCard extends GearCard {
  count: number;
  worth?: number;
  usable: boolean;
}

export interface GearView {
  slots: { slot: GearSlot; label: string; card: GearCard | null }[];
  carried: CarriedCard[];
}

const TRAIT_NAME = (trait: string): string => trait.charAt(0).toUpperCase() + trait.slice(1);
const RANGE_NAME: Record<string, string> = { melee: 'Melee', veryClose: 'Very Close', close: 'Close', far: 'Far', veryFar: 'Very Far' };
const BANNER: Record<ItemKind, string> = { weapon: 'Weapon', armor: 'Armor', consumable: 'Consumable', trinket: 'Item', key: 'Key' };

/** "d10+3", "2d6", "+3": a weapon's damage as a card prints it. */
function damageText(weapon: WeaponDef): string {
  const { count, sides, modifier } = weapon.damage;
  const dice = count === 0 ? '' : `${count === 1 ? '' : count}d${sides}`;
  return modifier === 0 ? dice : `${dice}${modifier > 0 ? '+' : ''}${modifier}`;
}

function weaponStats(weapon: WeaponDef): CardStat[] {
  const types = weapon.damage.types ?? ['physical'];
  return [
    { text: TRAIT_NAME(weapon.trait) },
    { text: RANGE_NAME[weapon.range] ?? weapon.range },
    { text: damageText(weapon), caption: types.map((type) => (type === 'magic' ? 'MAG' : 'PHY')).join('/') },
    { text: weapon.burden === 'twoHanded' ? 'Two-Handed' : 'One-Handed' },
  ];
}

function armorStats(armor: ArmorDef): CardStat[] {
  return [
    { text: `${armor.baseThresholds.major} / ${armor.baseThresholds.severe}`, caption: 'Thresholds' },
    { text: String(armor.baseScore), caption: 'Armor Score' },
    { text: String(armor.tier), caption: 'Tier' },
  ];
}

const featureOf = (def: WeaponDef | ArmorDef): GearCard['feature'] => (def.features[0] === undefined ? null : { name: def.features[0].name, text: def.features[0].text });

/** A weapon's card, from the weapon and - when there is one - the item that stands for it. */
function weaponCard(weapon: WeaponDef, item: ItemDef | undefined): GearCard {
  const secondary = weapon.slot === 'secondary';
  return {
    id: item?.id ?? weapon.id,
    name: item?.name ?? weapon.name,
    banner: secondary ? 'Secondary Weapon' : 'Weapon',
    kind: 'weapon',
    stats: weaponStats(weapon),
    feature: featureOf(weapon),
    text: '',
    tier: weapon.tier,
    ...(item?.card === undefined ? {} : { card: item.card }),
    fits: secondary ? 'secondary' : 'primary',
  };
}

function armorCard(armor: ArmorDef, item: ItemDef | undefined): GearCard {
  return {
    id: item?.id ?? armor.id,
    name: item?.name ?? armor.name,
    banner: 'Armor',
    kind: 'armor',
    stats: armorStats(armor),
    feature: featureOf(armor),
    text: '',
    tier: armor.tier,
    ...(item?.card === undefined ? {} : { card: item.card }),
    fits: 'armor',
  };
}

/** Any item as a card. Null for an id no item has. */
export function gearCard(demo: Pick<DemoScene, 'project'>, itemId: string): GearCard | null {
  const item = itemOf(demo.project, itemId);
  if (item === undefined) return null;
  const content = characterContentFor(demo.project);
  if (item.kind === 'weapon' && item.contentId !== undefined) {
    const weapon = content.weapons.get(item.contentId);
    if (weapon !== undefined) return weaponCard(weapon, item);
  }
  if (item.kind === 'armor' && item.contentId !== undefined) {
    const armor = content.armors.get(item.contentId);
    if (armor !== undefined) return armorCard(armor, item);
  }
  return {
    id: item.id,
    name: item.name,
    banner: BANNER[item.kind],
    kind: item.kind,
    stats: [],
    feature: null,
    text: item.description,
    ...(item.tier === undefined ? {} : { tier: item.tier }),
    ...(item.card === undefined ? {} : { card: item.card }),
    fits: null,
  };
}

/** A character's three places and the party's pack, as cards. */
export function gearView(demo: Pick<DemoScene, 'project' | 'sheets' | 'scenario'>, characterId: string): GearView {
  const sheet = demo.sheets.get(characterId);
  const content = characterContentFor(demo.project);
  const worn = (slot: GearSlot): GearCard | null => {
    const id = slot === 'primary' ? sheet?.primaryWeaponId : slot === 'secondary' ? sheet?.secondaryWeaponId : sheet?.armorId;
    if (id === undefined) return null;
    if (slot === 'armor') {
      const armor = content.armors.get(id);
      return armor === undefined ? null : armorCard(armor, itemForGear(demo, id));
    }
    const weapon = content.weapons.get(id);
    return weapon === undefined ? null : weaponCard(weapon, itemForGear(demo, id));
  };
  const carried: CarriedCard[] = [];
  // In the order the party came by them, as the pack always read; an id no item has is still carried.
  for (const [id, count] of demo.scenario.items) {
    if (count <= 0) continue;
    const item = itemOf(demo.project, id);
    const card = gearCard(demo, id) ?? { id, name: id, banner: 'Item', kind: 'trinket' as const, stats: [], feature: null, text: '', fits: null };
    carried.push({ ...card, count, ...(item?.value === undefined ? {} : { worth: item.value }), usable: (item?.use.length ?? 0) > 0 });
  }
  return { slots: GEAR_SLOTS.map(({ slot, label }) => ({ slot, label, card: worn(slot) })), carried };
}
