/**
 * The sheet a new character will have, before there is a game to have it in: New Game's last step
 * shows the character's sheet as the loadout will (`ui/SheetPaper.tsx`), so its numbers are worked
 * out the same way the game works them out.
 *
 * The sheet is the one Begin writes (`sheetFor`), in the camp it will begin at (`campProject`) with
 * the packs that camp lists laid (`withListedPacks`), read against that camp's character content
 * (`characterContentFor`) and the abilities it scripts, by the engine's own `deriveCharacter`. Nobody has been hurt yet: every pool
 * is empty, at the size the sheet makes it.
 */

import { deriveCharacter } from '../engine/character/sheet';
import { campProject } from './camp';
import { withListedPacks } from './listed-packs';
import { TRAIT_ORDER, sheetFor, type Creation } from './new-character';
import { characterContentFor } from './room';
import type { SheetStats } from './demo-abilities';
import type { HudMember } from './ui/PartyHud';

export interface SheetPreview {
  /** Who they are and how they are holding up, as the sheet's head draws it. */
  member: HudMember;
  /** The block of numbers. */
  stats: SheetStats;
}

/** The sheet of a character made as `creation` says, fresh. */
export function sheetPreview(creation: Creation): SheetPreview {
  const sheet = sheetFor(creation);
  const project = withListedPacks(campProject(sheet, 0));
  const content = characterContentFor(project);
  // With the abilities the camp's packs script, as the game derives it: a foundation that raises a
  // threshold raises it here too.
  const { character } = deriveCharacter(sheet, content, project.abilities);
  const armor = sheet.armorId === undefined ? undefined : content.armors.get(sheet.armorId);
  return {
    member: {
      id: sheet.id,
      name: sheet.name,
      role: content.classes.get(sheet.classId)?.name ?? sheet.classId,
      selected: false,
      alive: true,
      hitPoints: { marked: 0, max: character.hitPoints },
      stress: { marked: 0, max: character.stress },
      armorSlots: { marked: 0, max: character.armorScore },
      good: { value: character.good.value, max: character.good.max },
      conditions: [],
      canLevel: false,
      gear: `${character.primaryWeapon?.name ?? 'Unarmed'} · ${armor?.name ?? 'No armor'}`,
      group: null,
      model: creation.model,
    },
    stats: {
      level: sheet.level,
      proficiency: character.proficiency,
      evasion: character.evasion,
      thresholds: { ...character.thresholds },
      traits: TRAIT_ORDER.map((id) => ({ id, value: character.traits[id], spellcast: character.spellcastTrait === id })),
      experiences: character.experiences.map((experience) => ({ name: experience.name, modifier: experience.modifier })),
    },
  };
}
