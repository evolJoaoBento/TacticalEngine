/**
 * Interrupting a walk: stop everyone where they have actually got to.
 *
 * A walk resolves the moment it is ordered. `party.walkTo` moves the document straight to the end
 * of the line and the gliding that follows is only the drawing of it, which is what lets the rules
 * stay DOM-free and a fight replay without a renderer. The cost is that between the click and the
 * figure arriving, the character is in two places: the tile the document has them on, and the
 * ground the player can see them standing on.
 *
 * Everything a second click does has to be measured from the second one. Ordering a new walk from
 * the document's tile made the figure turn and slide across the room to rejoin a line it was
 * never on - and the line drawn under the pointer was drawn from there too, so the preview was
 * not a promise the walk kept. So before a new order is taken, whoever is still walking is landed:
 * put down where they are, their glide dropped, and their trail cut back to there.
 *
 * The followers matter as much as the leader. Their trail was handed the whole route when the walk
 * was ordered, so landing the leader alone leaves the others queueing along ground nobody crossed.
 */

import { worldToSpot, type TileLayout } from '../engine/render/layout';
import type { Spot } from '../engine/grid/grid';
import type { TileGrid } from '../engine/grid/grid';
import type { Party } from '../engine/scene/party';

/** As much of the view as landing needs: where the figures are, and the power to stop one. */
export interface Walking {
  isGliding(id: string): boolean;
  spotOf(id: string): Spot | null;
  land(id: string, at: Spot): boolean;
  readonly layout: TileLayout;
}

/** Where a character is standing to look at, which part-way through a walk is its own answer. */
export function standingNow(view: Walking, id: string | null): Spot | null {
  if (id === null || !view.isGliding(id)) return null;
  return view.spotOf(id);
}

/**
 * Put every figure still walking down where it stands, and hand back who was landed.
 *
 * Nobody standing still is touched, so this is safe to call before any order: with no walk in
 * flight it does nothing at all and costs one map lookup a party member.
 */
export function landWalkers(party: Party, view: Walking): string[] {
  const landed: string[] = [];
  for (const id of party.members()) {
    if (!view.isGliding(id)) continue;
    const at = view.spotOf(id);
    if (at === null) continue;
    if (party.landAt(id, at) && view.land(id, at)) landed.push(id);
  }
  return landed;
}

/** The spot a world position stands on, for a caller holding a position rather than a token. */
export function spotOfWorld(grid: TileGrid, layout: TileLayout, x: number, z: number): Spot {
  return worldToSpot(grid, x, z, layout);
}
