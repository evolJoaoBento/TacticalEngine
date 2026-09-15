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
import { inCombat, refreshWorld, setSheet, type DemoScene, type SheetChange } from './demo-scene';
import { characterContentFor } from './room';
import { note } from './log';

export type EquipResult = { ok: true; slot: 'primary' | 'secondary' | 'armor' } | { ok: false; reason: string };

/** The item in the project whose `contentId` is this piece of SRD gear, if any. */
function itemForGear(demo: Pick<DemoScene, 'project'>, contentId: string | undefined): ItemDef | undefined {
  if (contentId === undefined) return undefined;
  return demo.project.items.find((item) => item.contentId === contentId);
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
 */
export function equipItem(demo: SheetChange, characterId: string, itemId: string): EquipResult {
  const sheet = demo.sheets.get(characterId);
  if (sheet === undefined) return { ok: false, reason: `no character "${characterId}"` };
  const item = demo.project.items.find((candidate) => candidate.id === itemId);
  if (item === undefined) return { ok: false, reason: `no item "${itemId}"` };
  if ((demo.scenario.items.get(itemId) ?? 0) < 1) return { ok: false, reason: `the party is not carrying ${item.name}` };
  if (demo.pending !== null) return { ok: false, reason: 'not in the middle of a conversation' };
  if (item.contentId === undefined) return { ok: false, reason: `${item.name} is not something that can be worn` };

  let next: CharacterSheet;
  let slot: 'primary' | 'secondary' | 'armor';
  let replaced: string | undefined;
  if (item.kind === 'weapon') {
    const weapon = characterContentFor(demo.project).weapons.get(item.contentId);
    if (weapon === undefined) return { ok: false, reason: `${item.name} points at no known weapon` };
    slot = slotOf(weapon);
    replaced = slot === 'primary' ? sheet.primaryWeaponId : sheet.secondaryWeaponId;
    // Already in hand: nothing to swap, and taking it out of the pack would lose it.
    if (replaced === weapon.id) return { ok: false, reason: `${sheet.name} already wields the ${item.name}` };
    next = slot === 'primary' ? { ...sheet, primaryWeaponId: weapon.id } : { ...sheet, secondaryWeaponId: weapon.id };
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
  const returned = itemForGear(demo, replaced);
  if (returned !== undefined && returned.id !== itemId) demo.world.addItem(returned.id, 1);

  setSheet(demo, next);
  const derived = demo.characters.get(characterId)!;
  const entity = demo.state.entity(characterId);
  if (entity !== undefined) {
    entity.armorSlots = { max: derived.armorScore, marked: Math.min(entity.armorSlots.marked, derived.armorScore) };
  }
  // A new weapon is a new trait to roll: the world reads the sheet.
  refreshWorld(demo);
  note(demo, `${sheet.name} ${slot === 'armor' ? 'puts on' : 'takes up'} the ${item.name}.`, 'system');
  return { ok: true, slot };
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
