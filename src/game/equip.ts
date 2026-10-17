/**
 * What the party wields and wears, as the page reads it: the item in the pack a piece of gear on a sheet
 * stands for, and what a HUD line says about it. Putting a piece on and taking it off are the game's - the
 * engine's (`equipItem`, `unequipItem`) - and nothing in `demo-scene.ts` calls back into here.
 */

import type { ItemDef } from '../engine/content/items';
import { refreshWorld, setSheet, type DemoScene } from './demo-scene';
import { characterContentFor } from './room';
import { itemsFor } from '../engine/content/equipment/catalogue';

/** Where a piece goes on a sheet: the three places the rules have. */
export type GearSlot = 'primary' | 'secondary' | 'armor';

export type EquipResult = { ok: true; slot: GearSlot } | { ok: false; reason: string };

/** The item in the project whose `contentId` is this piece of SRD gear, if any. */
export function itemForGear(demo: Pick<DemoScene, 'project'>, contentId: string | undefined): ItemDef | undefined {
  if (contentId === undefined) return undefined;
  return itemsFor(demo.project).find((item) => item.contentId === contentId);
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
