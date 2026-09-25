/**
 * The equipment the engine ships: every weapon, suit of armour, item and consumable on the loot
 * cards, as content a project can use without restating it - the way the starter pack's classes
 * and cards are there for every project.
 *
 * `catalogue.json` is written by `tools/loot-cards.mjs` from a card export and read back through
 * the same schemas a project's own content is, so a card mapped wrong fails at load, loudly. A
 * weapon or a suit of armour is two rows, as it is anywhere in the engine: the `weaponDefSchema` /
 * `armorDefSchema` row a sheet wields, and the item the party carries, pointing at it through
 * `contentId`. Each item names its card's picture (`card`); the pictures are published beside the
 * models and fetched by `npm run models` (`equipment.lock.json`).
 *
 * A project's own item with the same id is the one used: `itemOf` and `itemsFor` lay the project
 * over the catalogue, as `characterContentFor` lays a project's weapons over the pack's.
 */

import { z } from 'zod';
import { armorDefSchema, weaponDefSchema } from '../pack/schema';
import { itemSchema, type ItemDef } from '../items';
import raw from './catalogue.json';

const catalogueSchema = z.object({
  weapons: z.array(weaponDefSchema),
  armors: z.array(armorDefSchema),
  items: z.array(itemSchema),
});

export const EQUIPMENT = catalogueSchema.parse(raw);

const BY_ID: ReadonlyMap<string, ItemDef> = new Map(EQUIPMENT.items.map((item) => [item.id, item]));

/** An item by id: the project's own when it has one, else the catalogue's. */
export function itemOf(project: { readonly items: readonly ItemDef[] }, id: string): ItemDef | undefined {
  return project.items.find((item) => item.id === id) ?? BY_ID.get(id);
}

/** Every item a project can name: its own, then the catalogue's it has not replaced. */
export function itemsFor(project: { readonly items: readonly ItemDef[] }): ItemDef[] {
  if (project.items.length === 0) return EQUIPMENT.items;
  const own = new Set(project.items.map((item) => item.id));
  return [...project.items, ...EQUIPMENT.items.filter((item) => !own.has(item.id))];
}
