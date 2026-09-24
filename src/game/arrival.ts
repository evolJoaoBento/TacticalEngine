/**
 * An interaction that waits for its walk: a click on a thing out of reach, or on somebody to talk
 * to, walks the selected member up to it - and only when the walk has ended, on the board as well
 * as in the document, is the thing used or the conversation opened. A right-click on the way, or a
 * new order, stops them where they have got to and the interaction never happens.
 *
 * The walk itself is the document's at once (`closeToUse`, `closeToStrike`); what waits is the
 * interaction, on `demo.approaching`, until the view says the walkers have stopped (`arrived`, run
 * from the frame loop beside an ambush's `arrive`). Headless there is no walk to watch - nothing is
 * `animated` - and the interaction happens at once, as it always did.
 */

import { DEMO_REACH, useSelectedOn, type DemoScene } from './demo-scene';
import { talkNow } from './interaction';
import { closeToUse } from './movement';

/** What a walk is for: the thing to use, or the creature to talk to, and who is walking there. */
export interface Approach {
  kind: 'use' | 'talk';
  id: string;
  who: string;
}

/**
 * Use a thing, walking up to it first when it is out of reach: at once when it is in reach, or
 * when the walk there ends. A walk that falls short is the move, and nothing is used.
 */
export function approachThenUse(demo: DemoScene, id: string): string {
  const who = demo.party.selected;
  if (who !== null && demo.pending === null && demo.ambush === null && demo.party.canCommand(who)) {
    if (closeToUse(demo, who, id, DEMO_REACH) === 'closed' && demo.animated) {
      demo.approaching = { kind: 'use', id, who };
      return 'walking';
    }
  }
  return useSelectedOn(demo, id).status;
}

/**
 * The walkers have stopped: do what the walk was for, with whoever walked. Nothing when nothing
 * was waiting, or when the one who walked is no longer who is selected - they were given another
 * order, which the waiting interaction does not outlive.
 */
export function arrived(demo: DemoScene): boolean {
  const waiting = demo.approaching;
  if (waiting === null) return false;
  demo.approaching = null;
  if (demo.party.selected !== waiting.who) return false;
  if (waiting.kind === 'use') useSelectedOn(demo, waiting.id);
  else talkNow(demo, waiting.who, waiting.id);
  return true;
}

/** Stop wanting to get there: the interaction a walk was for is dropped. Whether one was waiting. */
export function cancelApproach(demo: Pick<DemoScene, 'approaching'>): boolean {
  const was = demo.approaching !== null;
  demo.approaching = null;
  return was;
}
