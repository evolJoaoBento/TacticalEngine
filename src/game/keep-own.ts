/**
 * An adventure that keeps its party, joined by a character made of a pack it does not carry (`adventure-portal.ts`):
 * where the two define a class, a subclass, an ancestry or a community by one id - the Demo Vault's Human and the
 * SRD's - each keeps their own. Ids are one namespace in a project, and a card granted to an ancestry is granted to
 * whoever has an ancestry of that id, so laid together the two would give each other's features to both.
 *
 * So, once, as the adventure is begun: the adventure's own definition is pinned in the project - a listed pack lays
 * no id the project already has (`listed-packs.ts`) - and the pack's goes in beside it under an id of its own
 * (`<id>-<pack>`), with the pack's cards and subclasses that name it pointed at that id, and the newcomer's sheet too.
 * Everything else of the pack is laid as ever, by the pack listed.
 */

import type { ProjectDoc } from '../engine/scene/schema';
import type { CharacterSheet } from '../engine/character/sheet';
import { characterContentFor } from './room';
import { shippedPack } from './listed-packs';

/** The lists a character is made of by name, the field a sheet or a card's grant names one by, and that grant's kind. */
const NAMED = [
  ['classes', 'classId', 'class'],
  ['subclasses', 'subclassId', 'subclass'],
  ['ancestries', 'ancestryId', 'ancestry'],
  ['communities', 'communityId', 'community'],
] as const;

type Named = (typeof NAMED)[number][0];
type Entry = { id: string } & Record<string, unknown>;

/** The id the pack's own of an id the adventure has goes in by. */
export const ownId = (id: string, pack: string): string => `${id}-${pack}`;

/**
 * The project with the pack's colliding entries in beside the adventure's, and the newcomer's sheet pointed at them -
 * or both as they were, when the pack is not one this build has, or nothing collides.
 */
export function keepEachOwn<S extends CharacterSheet>(project: ProjectDoc, sheet: S, packId: string): { project: ProjectDoc; sheet: S } {
  const pack = shippedPack(packId);
  if (pack === null) return { project, sheet };
  // The adventure's own content, before the pack is laid: what this build gives every project, and what it carries.
  const theirs = characterContentFor(project);
  const out = structuredClone(project);
  const lists = out as unknown as Record<Named | 'cards', Entry[]>;
  const renamed = Object.fromEntries(NAMED.map(([list]) => [list, new Map<string, string>()])) as Record<Named, Map<string, string>>;
  for (const [list] of NAMED) {
    const map = theirs[list] as unknown as ReadonlyMap<string, Entry>;
    for (const entry of pack[list] as unknown as Entry[]) {
      const own = map.get(entry.id);
      if (own === undefined) continue;
      // The pack's own already, as a game it was kept in left it - its subclass pointed at its class renamed: no
      // collision. (One defined alike by both still is: the cards that name it are what differ.)
      const classId = list === 'subclasses' ? renamed.classes.get(String(entry['classId'])) : undefined;
      if (classId !== undefined && JSON.stringify(own) === JSON.stringify({ ...entry, classId })) continue;
      renamed[list].set(entry.id, ownId(entry.id, packId));
      if (!lists[list].some((kept) => kept.id === entry.id)) lists[list].push(structuredClone(own));
    }
  }
  if (NAMED.every(([list]) => renamed[list].size === 0)) return { project, sheet };
  const to = (list: Named, id: unknown): string | undefined => (typeof id === 'string' ? renamed[list].get(id) : undefined);

  // The pack's own, under their ids: a subclass of a class renamed belongs to the class's new id.
  for (const [list] of NAMED) {
    for (const entry of pack[list] as unknown as Entry[]) {
      const id = to(list, entry.id) ?? entry.id;
      const classId = list === 'subclasses' ? to('classes', entry['classId']) : undefined;
      if (id === entry.id && classId === undefined) continue;
      if (lists[list].some((kept) => kept.id === id)) continue;
      lists[list].push({ ...structuredClone(entry), id, ...(classId === undefined ? {} : { classId }) });
    }
  }
  // The pack's cards granted by what was renamed, granted by the new id - in the project under their own ids, which
  // the pack, laid after, then leaves alone.
  for (const card of pack.cards as unknown as (Entry & { grant: Record<string, unknown> })[]) {
    const grant = card.grant;
    const by = NAMED.find(([list, field, kind]) => grant['kind'] === kind && to(list, grant[field]) !== undefined);
    if (by === undefined) continue;
    const [list, field] = by;
    if (lists.cards.some((kept) => kept.id === card.id)) continue;
    lists.cards.push({ ...structuredClone(card), grant: { ...grant, [field]: to(list, grant[field]) } });
  }

  // The newcomer, pointed at the pack's own.
  const pointed = structuredClone(sheet) as S & Record<string, unknown>;
  for (const [list, field] of NAMED) {
    const id = to(list, pointed[field]);
    if (id !== undefined) (pointed as Record<string, unknown>)[field] = id;
  }
  const levels = (pointed.levels ?? []) as unknown as { advancements: { kind: string; classId?: string }[] }[];
  for (const level of levels) {
    for (const advancement of level.advancements) {
      const id = advancement.kind === 'multiclass' ? to('classes', advancement.classId) : undefined;
      if (id !== undefined) advancement.classId = id;
    }
  }
  return { project: out, sheet: pointed };
}
