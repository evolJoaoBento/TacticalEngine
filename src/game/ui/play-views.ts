/**
 * What the play screen shows, read off the game: the party's sheets on the HUD, the quests in the
 * journal, and what an open container holds.
 *
 * Plain functions of the demo, with no screen in them - `main.ts` hands the results to Preact.
 * Lifted out of `main.ts`, which is over its readability ceiling and may only get smaller.
 */

import { journalSummary } from '../../engine/content/quests';
import type { DemoScene } from '../demo-scene';
import { gearOf } from '../equip';
import { awaitingLevel } from '../level-up';
import { inCombat } from '../moment';
import { characterContentFor } from '../room';
import type { HudMember } from './PartyHud';
import type { JournalQuest, OpenContainer } from './PlayPanel';
import { closeContainer, containerContents, openContainer, shopOpen, takeFromContainer } from '../prop-use';
import { talkingAside } from '../talks';
import { nameOf } from '../log';
import { purse, sellTo, sellables, shopOf } from '../shop';
import { interactablesOf } from '../../engine/scene/prop-functions';
import type { Spot } from '../../engine/grid/grid';
import type { TalkingView } from './Conversation';

/** The journal: every quest the party has been given, joined to its words. */
export function journalEntries(demo: DemoScene): JournalQuest[] {
  const entries: JournalQuest[] = [];
  for (const quest of demo.project.quests) {
    const progress = demo.scenario.quests.get(quest.id);
    if (progress === undefined) continue;
    entries.push({
      id: quest.id,
      name: quest.name,
      // As far into the story as the party has got, not the opening line.
      summary: journalSummary(quest, progress),
      status: progress.status,
      objectives: quest.objectives
        // A hidden step stays out of the journal until revealed or done.
        .filter((o) => !o.hidden || progress.revealed.has(o.id) || progress.done.has(o.id))
        .map((o) => ({ id: o.id, text: o.text, done: progress.done.has(o.id) })),
    });
  }
  // Active first; finished ones sink to the tail.
  return entries.sort((a, b) => Number(a.status !== 'active') - Number(b.status !== 'active'));
}

/** What the HUD shows for each party member, in the party's order. */
export function hudMembers(demo: DemoScene): HudMember[] {
  const waiting = new Set(awaitingLevel(demo));
  const aside = new Set(talkingAside(demo));
  // Groups are numbered by their first member, in the party's order, for the band on the cards.
  const groups = [...new Set(demo.party.members().map((id) => demo.party.groupOf(id)[0]!))];
  return demo.party.members().map((id) => demo.state.entity(id)!).map((entity) => {
    const character = demo.characters.get(entity.id);
    const sheet = character?.sheet;
    const role = sheet === undefined ? '' : (characterContentFor(demo.project).classes.get(sheet.classId)?.name ?? sheet.classId);
    return {
      id: entity.id,
      name: sheet?.name ?? entity.id,
      role,
      selected: demo.party.selected === entity.id,
      alive: entity.alive,
      hitPoints: { ...entity.hitPoints },
      stress: { ...entity.stress },
      armorSlots: { ...entity.armorSlots },
      ...(entity.good === undefined ? {} : { good: { ...entity.good } }),
      // What they are called rather than their ids: a HUD is read by a player.
      conditions: [...entity.conditions].map((c) => demo.world.conditionName(c)),
      canLevel: waiting.has(entity.id) && !inCombat(demo) && demo.pending === null && !aside.has(entity.id),
      gear: `${gearOf(demo, entity.id).weapon} · ${gearOf(demo, entity.id).armor}`,
      group: demo.party.groupOf(entity.id).length > 1 ? groups.indexOf(demo.party.groupOf(entity.id)[0]!) : null,
      talking: aside.has(entity.id),
    };
  });
}

/**
 * The container window, when one is open: its contents, and what Take and Close do.
 *
 * Shut when whoever opened it has walked out of reach, the way a real chest stops being in front
 * of you - otherwise a window left open would let the party empty a chest from across the room.
 */
export function containerView(demo: DemoScene, reach: (id: string) => boolean, refresh: () => void): OpenContainer | null {
  const id = openContainer(demo);
  if (id === null) return null;
  if (!reach(id)) {
    closeContainer(demo);
    return null;
  }
  const prop = demo.scene.decos.find((deco) => deco.id === id);
  // A shop says what it is paid in and how much of it the party has; a merchant is called by name.
  const shop = shopOf(demo, id);
  return {
    id,
    name: prop === undefined ? (demo.state.entity(id) === undefined ? 'Container' : nameOf(demo, id)) : prop.model.replace(/[-_]+/g, ' ').replace(/^./, (letter) => letter.toUpperCase()),
    lines: containerContents(demo, id),
    ...(shop === null ? {} : {
      paidIn: { name: demo.project.items.find((item) => item.id === shop.currency)?.name ?? shop.currency, held: purse(demo, shop) },
      // What the party can sell back: the seller's own lines, for half.
      selling: sellables(demo, id),
      onSell: (item: string) => {
        sellTo(demo, id, item);
        refresh();
      },
    }),
    onTake: (item) => {
      takeFromContainer(demo, id, item);
      refresh();
    },
    onClose: () => {
      closeContainer(demo);
      refresh();
    },
  };
}

/** The party's pack, joined to the project's item names - and worths, so a player knows what a thing fetches. */
export function carriedItems(demo: Pick<DemoScene, 'project' | 'scenario'>): { id: string; name: string; quantity: number; wearable: boolean; usable: boolean; value?: number }[] {
  const items = new Map(demo.project.items.map((item) => [item.id, item]));
  return [...demo.scenario.items]
    .filter(([, quantity]) => quantity > 0)
    .map(([id, quantity]) => {
      const item = items.get(id);
      return {
        id,
        name: item?.name ?? id,
        quantity,
        wearable: (item?.kind === 'weapon' || item?.kind === 'armor') && item.contentId !== undefined,
        usable: (item?.use.length ?? 0) > 0,
        ...(item?.value === undefined ? {} : { value: item.value }),
      };
    });
}

/**
 * The conversation on screen, if one is: what is being said and what can be answered - held, the
 * replies shut, while a shop it opened is still open.
 */
export function talkingView(demo: DemoScene): TalkingView | null {
  const pending = demo.pending;
  const view = pending !== null && pending.kind === 'script' ? (pending.dialogue?.view ?? null) : null;
  return view === null || !shopOpen(demo) ? view : { ...view, held: 'Close the shop to go on.' };
}

/**
 * Where whoever the party is talking to stands, while a conversation is open: the creature it is
 * with, or the thing that was used to open it. The camera is held there (`CameraFocus`). Null when
 * nothing is being said, or it was opened by something that stands nowhere - an item in the pack.
 */
export function talkingTo(demo: Pick<DemoScene, 'pending' | 'state' | 'scene' | 'grid'>): Spot | null {
  const pending = demo.pending;
  if (pending === null || pending.kind !== 'script' || pending.dialogue === null) return null;
  if (pending.with !== undefined) return demo.state.entity(pending.with)?.at ?? null;
  if (pending.interactable === null) return null;
  const thing = interactablesOf(demo.scene).find((object) => object.id === pending.interactable);
  return thing === undefined ? null : demo.grid.spotOf(demo.grid.indexOf(thing.position.x, thing.position.y));
}
