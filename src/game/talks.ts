/**
 * A conversation is the one having it's, not the whole party's. Select somebody else - Tab, a
 * card, a click - and it is set aside: it leaves the screen, the camera lets go, and the rest of
 * the party goes on as if nothing were being said, while the one talking is held where they stand
 * (`Party.hold`): no orders, and the others walk off without them. They are still in their group.
 * Select them again and the conversation is back where it was - with the shop it had open, if it
 * had one - and once it ends they are let go.
 *
 * Out of a fight only: a creature that stops a fight to talk holds the fight, as it always did. A
 * fight that begins, or the room entered afresh (travel, a load), ends every conversation set aside.
 *
 * The one prompt the engine waits on is still `demo.pending`, and everything that refuses while it
 * is set keeps refusing; setting a conversation aside is moving it off that slot and back. Run
 * `syncTalks` whenever the selection may have changed (`main.ts` runs it on every refresh).
 */

import type { Party } from '../engine/scene/party';
import type { DemoScene, PendingScript } from './demo-scene';

/**
 * A conversation set aside: the prompt it was, the shop it had open, and the party it was set aside
 * from - a room entered afresh, by travel or by a load, has a party of its own, and a conversation
 * from before it is over.
 */
interface SetAside {
  pending: PendingScript;
  shop: string | null;
  party: Party;
}

const setAside = new WeakMap<DemoScene, Map<string, SetAside>>();

function talksOf(demo: DemoScene): Map<string, SetAside> {
  let talks = setAside.get(demo);
  if (talks === undefined) setAside.set(demo, (talks = new Map()));
  return talks;
}

/** Everybody in a conversation that is set aside. */
export function talkingAside(demo: DemoScene): string[] {
  return [...talksOf(demo).keys()];
}

/**
 * The conversations set aside as a board gives them - who is having each - stood in a page's game filled from
 * an engine's board (`restoreFromBoard`): the engine holds the conversations themselves and plays them on; the
 * page knows who is talking, which is all its views read. No prompt is kept: the page does not bring one back.
 */
export function asideFrom(demo: DemoScene, talkers: readonly string[]): void {
  const talks = talksOf(demo);
  talks.clear();
  for (const who of talkers) talks.set(who, { pending: null as unknown as PendingScript, shop: null, party: demo.party });
}
