/**
 * Which models a new character of an ancestry may be drawn with.
 *
 * A model belongs to the ancestry it has been given in the editor's Models page, which is kept for
 * every project in `projects/model-ancestries.json` (`model-ancestries.ts`) and served with the model
 * list as its `ancestry`. A model given none belongs by its file's name: one whose id starts with the
 * ancestry's id and a hyphen - `elf-ranger.glb`, `dwarf-2.glb` - is one of that ancestry's. What it has
 * been given wins over its name, so a file named for one ancestry can be given to another. An ancestry
 * nobody has a model for yet is offered the company's own models, which belong to no ancestry in
 * particular (`CAMP_CREW`); the moment one of its own is added, its own are what it offers.
 */

import { CAMP_CREW } from './camp';

/** The models an ancestry offers, by id: its own, or - while it has none - the company's. */
export function modelsForAncestry(ancestryId: string, shipped: readonly { id: string; ancestry?: string }[]): string[] {
  const own = shipped.filter((model) => ancestryOfModel(model, [ancestryId]) === ancestryId).map((model) => model.id);
  return own.length > 0 ? own : CAMP_CREW.filter((id) => shipped.some((model) => model.id === id));
}

/**
 * The ancestry a model draws: the one it was given, or else the one of these its file is named for,
 * the longest name first so `wood-elf-2` is a wood elf's and not an elf's; nothing when neither.
 */
export function ancestryOfModel(model: { id: string; ancestry?: string }, ancestryIds: readonly string[]): string | undefined {
  if (model.ancestry !== undefined) return model.ancestry;
  return [...ancestryIds].sort((a, b) => b.length - a.length).find((id) => model.id.startsWith(`${id}-`));
}

/** A model's id as a name to show: `wood-elf-2` is "Wood Elf 2". */
export function modelName(id: string): string {
  return id.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}
