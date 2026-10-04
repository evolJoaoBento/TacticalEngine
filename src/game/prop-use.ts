/**
 * What the game does with a prop's function once a script has run: a container's window - or a
 * shop's, which is the same window with a price on each line (`game/shop.ts`) - a portal's other
 * end, and travel.
 *
 * The runner journals `openContainer`, `teleport` and `goto` and stops there, because each of them
 * needs something the rules do not have - a screen to show a chest's contents on, a map to find a
 * portal's partner on. This is where the journal is read and they happen.
 *
 * Which container is open, and which portal the party is arriving by, are passing states of the
 * screen rather than facts about the game: nothing in a save needs them, and a reload rightly
 * forgets a window that was open. So they are kept here, beside the demo they belong to, rather
 * than on it.
 */

import { NO_TILE } from '../engine/grid/grid';
import { containerItems, interactablesOf, objectsToProps } from '../engine/scene/prop-functions';
import { type DemoScene } from './demo-scene';
import { shopContents, shopOf } from './shop';
import { itemOf } from '../engine/content/equipment/catalogue';

/** Everything usable in a room, props included: re-exported so the game reads it from where it acts on it. */
export { interactablesOf, objectsToProps };

type Demo = Pick<DemoScene, 'project' | 'scene' | 'grid' | 'state' | 'party' | 'scenario' | 'world' | 'log' | 'destination' | 'motions' | 'encounter' | 'characters' | 'sheets'>;

/** The container whose window is open, by the demo it is open in. */
const opened = new WeakMap<object, string>();

/**
 * One thing in an open container: what it is, what it is called, and how many are left - and in a
 * shop, what it costs, with no end to a line that has no count.
 */
export interface ContainerLine {
  item: string;
  name: string;
  count: number;
  price?: number;
}

/** The container whose window is open, if there is one here still to be open. */
export function openContainer(demo: Demo): string | null {
  const id = opened.get(demo) ?? null;
  // Gone from the room: a prop taken away, or a merchant who is no longer standing there.
  if (id !== null && !demo.scene.decos.some((deco) => deco.id === id) && demo.state.entity(id)?.alive !== true) opened.delete(demo);
  return opened.get(demo) ?? null;
}

export function closeContainer(demo: Demo): void {
  opened.delete(demo);
}

/** Open a container's window again - a shop a conversation had open, brought back with it. */
export function showContainer(demo: Demo, id: string): void {
  opened.set(demo, id);
}

/** Whether what is open is a shop: its window is over everything, and a conversation waits on it. */
export function shopOpen(demo: Demo): boolean {
  const id = openContainer(demo);
  return id !== null && shopOf(demo, id) !== null;
}

/**
 * What is still inside a container: what was put in it, less what has been taken.
 *
 * What was taken is kept on the container's own state, which is saved with the room, so a chest
 * emptied and left is still empty when the party comes back or the game is loaded.
 */
export function containerContents(demo: Demo, id: string): ContainerLine[] {
  if (shopOf(demo, id) !== null) return shopContents(demo, id).map((line) => ({ item: line.item, name: line.name, count: line.left ?? Infinity, price: line.price }));
  const prop = demo.scene.decos.find((deco) => deco.id === id);
  const taken = demo.state.interactable(id).data;
  return containerItems(prop?.function)
    .map(({ item, count }) => ({ item, name: itemOf(demo.project, item)?.name ?? item, count: count - takenOf(taken, item) }))
    .filter((line) => line.count > 0);
}

const takenOf = (data: Readonly<Record<string, string | number | boolean>>, item: string): number => {
  const taken = data[`taken:${item}`];
  return typeof taken === 'number' ? taken : 0;
};

/** The tile a thing covers that is nearest to `here`: a prop drawn across a block is reached from any side of it. */
export function nearestCovered(demo: Pick<DemoScene, 'grid' | 'state'>, id: string, here: number): number {
  let best = NO_TILE;
  let bestAway = Infinity;
  // A creature - a merchant - covers the tile it stands on.
  const covers = demo.state.interactableCovers(id);
  const standing = demo.state.entity(id)?.tile ?? NO_TILE;
  for (const tile of covers.length === 0 && standing !== NO_TILE ? [standing] : covers) {
    const away = Math.max(Math.abs(demo.grid.xOf(tile) - demo.grid.xOf(here)), Math.abs(demo.grid.yOf(tile) - demo.grid.yOf(here)));
    if (away < bestAway) {
      best = tile;
      bestAway = away;
    }
  }
  return best;
}

/** Whether the selected member can still reach a thing: a container's window shuts once they cannot. */
export function withinReach(demo: Pick<DemoScene, 'grid' | 'state' | 'party'>, id: string, reach: number): boolean {
  const who = demo.party.selected;
  const here = who === null ? NO_TILE : (demo.state.entity(who)?.tile ?? NO_TILE);
  if (here === NO_TILE) return false;
  const there = nearestCovered(demo, id, here);
  return there !== NO_TILE && Math.max(Math.abs(demo.grid.xOf(there) - demo.grid.xOf(here)), Math.abs(demo.grid.yOf(there) - demo.grid.yOf(here))) <= reach;
}
