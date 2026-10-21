/**
 * Buying: what a seller has, what is left of it, and paying for one.
 *
 * A shop is kept by a thing - a prop with the Shop function, or a creature whose interaction
 * carries one - the way a chest keeps its contents: the stock is on the seller, and the effect that
 * opens the window (`openShop`) only says whose. The window is the container window with a price on
 * each line (`game/ui/play-views.ts`); what is bought out of a stock with a limit is counted on the
 * seller's saved state, so a shop sold out stays sold out across a save.
 *
 * A seller buys what the party carries for its share of what it is worth - half, unless the shop
 * says (`buysAt`) - rounded down and never nothing: its own lines by its own price, one with a count
 * going back onto its shelf, and anything else by the item's `value`. An item with no value, and
 * its own coin, it will not buy.
 */

import { findFunction } from '../engine/scene/prop-functions';
import type { Shop } from '../engine/scene/prop-function-schema';
import type { DemoScene } from './demo-scene';
import { itemOf, itemsFor } from '../engine/content/equipment/catalogue';

type Demo = Pick<DemoScene, 'project' | 'scene' | 'state' | 'party' | 'world' | 'log' | 'characters' | 'sheets'>;

/** The shop a thing keeps: a prop's Shop function, or a creature's interaction. */
export function shopOf(demo: Pick<DemoScene, 'scene'>, id: string): Shop | null {
  const prop = demo.scene.decos.find((deco) => deco.id === id);
  if (prop !== undefined) return findFunction(prop.function, 'shop')?.shop ?? null;
  for (const encounter of demo.scene.encounters) {
    const placed = encounter.adversaries.find((placement) => placement.id === id);
    if (placed !== undefined) return placed.interaction?.shop ?? null;
  }
  return null;
}

/** One thing for sale: what it is called, what it costs, and how many are left (null: no end to them). */
export interface ShopLine {
  item: string;
  name: string;
  price: number;
  left: number | null;
}

const boughtOf = (data: Readonly<Record<string, string | number | boolean>>, item: string): number => {
  const bought = data[`bought:${item}`];
  return typeof bought === 'number' ? bought : 0;
};

/** What a seller still has, in the order it was stocked. A line sold out is not offered. */
export function shopContents(demo: Demo, id: string): ShopLine[] {
  const shop = shopOf(demo, id);
  if (shop === null) return [];
  const bought = demo.state.interactable(id).data;
  return shop.stock
    .map((line) => ({
      item: line.item,
      name: itemOf(demo.project, line.item)?.name ?? line.item,
      price: line.price,
      left: line.count === undefined ? null : line.count - boughtOf(bought, line.item),
    }))
    .filter((line) => line.left === null || line.left > 0);
}

/** How much of what a seller is paid in the party is carrying. */
export function purse(demo: Pick<DemoScene, 'world'>, shop: Shop): number {
  let held = 0;
  while (demo.world.hasItem(shop.currency, held + 1)) held++;
  return held;
}

/** What a seller pays for its share of a worth - half unless it says - rounded down, and never nothing. */
export const buyBackPrice = (worth: number, percent = 50): number =>
  worth <= 0 || percent <= 0 ? 0 : Math.max(1, Math.floor((worth * percent) / 100));

/** One thing the party could sell: what it is, how many they carry, and what the seller pays for one. */
export interface SaleLine {
  item: string;
  name: string;
  held: number;
  price: number;
}

/** What a seller pays for one of something: its share (`buysAt`, half) of its own price for one of its lines, else of the item's value. */
export function offerFor(demo: Pick<DemoScene, 'project' | 'scene'>, shop: Shop, item: string): number {
  if (item === shop.currency) return 0;
  const stocked = shop.stock.find((line) => line.item === item);
  const worth = stocked !== undefined ? stocked.price : itemOf(demo.project, item)?.value ?? 0;
  return buyBackPrice(worth, shop.buysAt ?? 50);
}

/**
 * What the party carries that the seller will buy, and for how much: its own lines first, in the
 * order it stocks them, then everything else of value in the order the project lists its items.
 */
export function sellables(demo: Demo, id: string): SaleLine[] {
  const shop = shopOf(demo, id);
  if (shop === null) return [];
  const order = [...new Set([...shop.stock.map((line) => line.item), ...itemsFor(demo.project).map((item) => item.id)])];
  const lines: SaleLine[] = [];
  for (const item of order) {
    const price = offerFor(demo, shop, item);
    if (price === 0) continue;
    let held = 0;
    while (demo.world.hasItem(item, held + 1)) held++;
    if (held === 0) continue;
    lines.push({ item, name: itemOf(demo.project, item)?.name ?? item, held, price });
  }
  return lines;
}
