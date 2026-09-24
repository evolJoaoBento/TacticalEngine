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
import { inCombat } from './moment';
import { nameOf, note } from './log';
import { closeContainer, openContainer, showContainer } from './prop-use';
import { shopOf } from './shop';

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

/** Who is having the conversation on screen, if one is: the member it was opened by. */
export function talkerOf(demo: Pick<DemoScene, 'pending'>): string | null {
  const pending = demo.pending;
  return pending !== null && pending.kind === 'script' ? (pending.dialogue?.by ?? null) : null;
}

/** Everybody in a conversation that is set aside. */
export function talkingAside(demo: DemoScene): string[] {
  return [...talksOf(demo).keys()];
}

/**
 * Put the conversations where the selection says: the one on screen set aside when somebody
 * else is selected, and the selected member's own brought back. Whether anything moved.
 */
export function syncTalks(demo: DemoScene): boolean {
  const talks = talksOf(demo);
  let moved = breakOff(demo, talks);
  const who = demo.party.selected;
  const talker = talkerOf(demo);
  if (talker !== null && talker !== who && !inCombat(demo) && demo.gmTurn === null && demo.party.hold(talker)) {
    const open = openContainer(demo);
    const shop = open !== null && shopOf(demo, open) !== null ? open : null;
    if (shop !== null) closeContainer(demo);
    talks.set(talker, { pending: demo.pending as PendingScript, shop, party: demo.party });
    demo.pending = null;
    moved = true;
  }
  const waiting = who === null ? undefined : talks.get(who);
  if (waiting !== undefined && demo.pending === null) {
    talks.delete(who!);
    demo.party.release(who!);
    demo.pending = waiting.pending;
    if (waiting.shop !== null) showContainer(demo, waiting.shop);
    moved = true;
  }
  return moved;
}

/**
 * A fight, the one talking fallen, or a room entered afresh - travel, or a save loaded: what was
 * set aside is over. Only a fight says so; a room entered afresh never had it.
 */
function breakOff(demo: DemoScene, talks: Map<string, SetAside>): boolean {
  let broken = false;
  for (const [who, talk] of talks) {
    const standing = demo.state.entity(who)?.alive === true;
    const here = talk.party === demo.party;
    if (standing && here && !inCombat(demo)) continue;
    talks.delete(who);
    talk.party.release(who);
    if (standing && here) note(demo, `${nameOf(demo, who)} breaks off the conversation.`, 'system');
    broken = true;
  }
  return broken;
}
