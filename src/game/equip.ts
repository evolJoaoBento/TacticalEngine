/**
 * Wielding and wearing what the party carries.
 *
 * A sheet names its gear by content id and the pack holds items; this is the
 * exchange between them — a piece out of the pack and onto the sheet, the old
 * one back in — and what a HUD line says about it. Nothing in `demo-scene.ts`
 * calls back into here.
 */

import type { CharacterSheet } from '../engine/character/sheet';
import type { ItemDef } from '../engine/content/items';
import type { WeaponDef } from '../engine/content/pack/import';
import { refreshWorld, setSheet, type DemoScene, type SheetChange } from './demo-scene';
import { inCombat } from './moment';
import { characterContentFor } from './room';
import { note } from './log';
import { itemOf, itemsFor } from '../engine/content/equipment/catalogue';

/** Where a piece goes on a sheet: the three places the rules have. */
export type GearSlot = 'primary' | 'secondary' | 'armor';

export type EquipResult = { ok: true; slot: GearSlot } | { ok: false; reason: string };

/** The item in the project whose `contentId` is this piece of SRD gear, if any. */
export function itemForGear(demo: Pick<DemoScene, 'project'>, contentId: string | undefined): ItemDef | undefined {
  if (contentId === undefined) return undefined;
  return itemsFor(demo.project).find((item) => item.contentId === contentId);
}

/** Which slot a weapon goes in: shields and the like are secondary, the rest primary. */
function slotOf(weapon: WeaponDef): 'primary' | 'secondary' {
  return weapon.slot === 'secondary' ? 'secondary' : 'primary';
}

/**
 * Put a carried weapon or armor on a character.
 *
 * The pack is the party's, so anyone can wear anything it holds; the piece
 * comes out of the pack and whatever it replaces goes back in, as long as the
 * project has an item for it — a sheet's starting gear is SRD content that may
 * have no item, in which case it is simply set aside. The sheet is re-derived
 * and the live pools follow: Armor Slots rise or fall with the armor, nothing
 * marked is cleared. Armor cannot be changed mid-fight; a weapon can.
 *
 * Hands are counted. A two-handed primary leaves none for a secondary, which goes back in the pack
 * with the old primary; and a secondary is refused while the primary in hand takes both.
 */
export function equipItem(demo: SheetChange, characterId: string, itemId: string): EquipResult {
  const sheet = demo.sheets.get(characterId);
  if (sheet === undefined) return { ok: false, reason: `no character "${characterId}"` };
  const item = itemOf(demo.project, itemId);
  if (item === undefined) return { ok: false, reason: `no item "${itemId}"` };
  if ((demo.scenario.items.get(itemId) ?? 0) < 1) return { ok: false, reason: `the party is not carrying ${item.name}` };
  if (demo.pending !== null) return { ok: false, reason: 'not in the middle of a conversation' };
  if (item.contentId === undefined) return { ok: false, reason: `${item.name} is not something that can be worn` };

  let next: CharacterSheet;
  let slot: 'primary' | 'secondary' | 'armor';
  let replaced: string | undefined;
  let freed: string | undefined;
  if (item.kind === 'weapon') {
    const weapons = characterContentFor(demo.project).weapons;
    const weapon = weapons.get(item.contentId);
    if (weapon === undefined) return { ok: false, reason: `${item.name} points at no known weapon` };
    slot = slotOf(weapon);
    replaced = slot === 'primary' ? sheet.primaryWeaponId : sheet.secondaryWeaponId;
    // Already in hand: nothing to swap, and taking it out of the pack would lose it.
    if (replaced === weapon.id) return { ok: false, reason: `${sheet.name} already wields the ${item.name}` };
    const primary = sheet.primaryWeaponId === undefined ? undefined : weapons.get(sheet.primaryWeaponId);
    if (slot === 'secondary' && primary?.burden === 'twoHanded') return { ok: false, reason: `the ${primary.name} takes both of ${sheet.name}'s hands` };
    if (slot === 'primary') {
      next = { ...sheet, primaryWeaponId: weapon.id };
      if (weapon.burden === 'twoHanded' && sheet.secondaryWeaponId !== undefined) {
        freed = sheet.secondaryWeaponId;
        next = without(next, 'secondaryWeaponId');
      }
    } else next = { ...sheet, secondaryWeaponId: weapon.id };
  } else if (item.kind === 'armor') {
    if (inCombat(demo)) return { ok: false, reason: 'armor cannot be changed in a fight' };
    const armor = characterContentFor(demo.project).armors.get(item.contentId);
    if (armor === undefined) return { ok: false, reason: `${item.name} points at no known armor` };
    slot = 'armor';
    replaced = sheet.armorId;
    if (replaced === armor.id) return { ok: false, reason: `${sheet.name} already wears the ${item.name}` };
    next = { ...sheet, armorId: armor.id };
  } else {
    return { ok: false, reason: `${item.name} is not something that can be worn` };
  }

  // Out of the pack, and the old piece back in when the project has an item for it.
  demo.world.removeItem(itemId, 1);
  for (const back of [replaced, freed]) {
    const returned = itemForGear(demo, back);
    if (returned !== undefined && returned.id !== itemId) demo.world.addItem(returned.id, 1);
  }
  wear(demo, characterId, next);
  note(demo, `${sheet.name} ${slot === 'armor' ? 'puts on' : 'takes up'} the ${item.name}.`, 'system');
  return { ok: true, slot };
}

/** Where a slot is written on a sheet. */
const SHEET_FIELD = { primary: 'primaryWeaponId', secondary: 'secondaryWeaponId', armor: 'armorId' } as const;

/** A sheet with one of its gear fields gone - not set to undefined, which a sheet may not hold. */
function without(sheet: CharacterSheet, field: (typeof SHEET_FIELD)[GearSlot]): CharacterSheet {
  const next = { ...sheet };
  delete next[field];
  return next;
}

/**
 * Take a piece off and put it back in the pack. Refused when there is nothing there, mid-way
 * through anything, for armour in a fight - as putting it on is - and for a piece no item stands for,
 * which would have nowhere to go.
 */
export function unequipItem(demo: SheetChange, characterId: string, slot: GearSlot): EquipResult {
  const sheet = demo.sheets.get(characterId);
  if (sheet === undefined) return { ok: false, reason: `no character "${characterId}"` };
  if (demo.pending !== null) return { ok: false, reason: 'not in the middle of a conversation' };
  const worn = sheet[SHEET_FIELD[slot]];
  if (worn === undefined) return { ok: false, reason: `${sheet.name} has nothing there` };
  if (slot === 'armor' && inCombat(demo)) return { ok: false, reason: 'armor cannot be changed in a fight' };
  const item = itemForGear(demo, worn);
  if (item === undefined) return { ok: false, reason: `there is nothing to put that back in the pack as` };
  demo.world.addItem(item.id, 1);
  wear(demo, characterId, without(sheet, SHEET_FIELD[slot]));
  note(demo, `${sheet.name} ${slot === 'armor' ? 'takes off' : 'puts away'} the ${item.name}.`, 'system');
  return { ok: true, slot };
}

/** Write the sheet, and the live pools after it: Armor Slots follow the armour, nothing marked is cleared. */
function wear(demo: SheetChange, characterId: string, next: CharacterSheet): void {
  setSheet(demo, next);
  const derived = demo.characters.get(characterId)!;
  const entity = demo.state.entity(characterId);
  if (entity !== undefined) {
    entity.armorSlots = { max: derived.armorScore, marked: Math.min(entity.armorSlots.marked, derived.armorScore) };
  }
  // A new weapon is a new trait to roll: the world reads the sheet.
  refreshWorld(demo);
}

/** What a character is wielding and wearing, by name, for a HUD line. */
export function gearOf(demo: Pick<DemoScene, 'characters' | 'project'>, characterId: string): { weapon: string; armor: string } {
  const character = demo.characters.get(characterId);
  return {
    weapon: character?.primaryWeapon?.name ?? 'Unarmed',
    armor:
      character?.sheet.armorId === undefined
        ? 'Unarmored'
        : (characterContentFor(demo.project).armors.get(character.sheet.armorId)?.name ?? 'Unarmored'),
  };
}
