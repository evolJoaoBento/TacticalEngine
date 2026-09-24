/**
 * Buying: what a seller has, what is left of it, and paying for one.
 *
 * A shop is kept by a thing - a prop with the Shop function, or a creature whose interaction
 * carries one - the way a chest keeps its contents: the stock is on the seller, and the effect that
 * opens the window (`openShop`) only says whose. The window is the container window with a price on
 * each line (`game/ui/play-views.ts`); what is bought out of a stock with a limit is counted on the
 * seller's saved state, so a shop sold out stays sold out across a save.
 */

import { findFunction } from '../engine/scene/prop-functions';
import type { Shop } from '../engine/scene/prop-function-schema';
import type { DemoScene } from './demo-scene';
import { nameOf, note } from './log';

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

/** What a seller is called on its window: a merchant's own name where it was given one, else its kind's. */
export function sellerName(demo: Pick<DemoScene, 'scene'>, id: string): string | null {
  for (const encounter of demo.scene.encounters) {
    const placed = encounter.adversaries.find((placement) => placement.id === id);
    if (placed?.name !== undefined) return placed.name;
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
      name: demo.project.items.find((known) => known.id === line.item)?.name ?? line.item,
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

/**
 * Buy one of something: the price leaves the party's pack, the thing goes into it, and a limited
 * line has one fewer. Refused, with a word in the log, when the party cannot pay or it is gone.
 */
export function buyFrom(demo: Demo, id: string, item: string): boolean {
  const shop = shopOf(demo, id);
  const line = shopContents(demo, id).find((candidate) => candidate.item === item);
  if (shop === null || line === undefined) return false;
  const currency = demo.project.items.find((known) => known.id === shop.currency)?.name ?? shop.currency;
  if (!demo.world.hasItem(shop.currency, line.price)) {
    note(demo, `Not enough ${currency.toLowerCase()} for ${line.name}: it costs ${line.price}.`, 'system');
    return false;
  }
  if (line.price > 0) demo.world.removeItem(shop.currency, line.price);
  demo.world.addItem(item, 1);
  if (line.left !== null) {
    const state = demo.state.interactable(id);
    state.data[`bought:${item}`] = boughtOf(state.data, item) + 1;
  }
  const who = demo.party.selected;
  note(demo, `${who === null ? 'The party' : nameOf(demo, who)} buys ${line.name} for ${line.price} ${currency.toLowerCase()}.`, 'success');
  return true;
}
