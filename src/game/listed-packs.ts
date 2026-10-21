/**
 * The packs a project is played with, by name.
 *
 * A project lists the shipped packs it wants (`project.packs`): `srd-characters` is the SRD's
 * classes, subclasses, ancestries, communities and cards, with the abilities, conditions and
 * scripts they run. When the project opens, each listed pack is laid over the project's own lists -
 * the project's entry winning wherever it has one of the same id, as a project's content always wins
 * over a pack's - and when it is saved, what the packs put there is left out again, so the file holds
 * only what is the project's own, and a pack's next version reaches every project that lists it.
 *
 * Shipped packs are bundled, not fetched: opening a project by hand is synchronous, and so is this.
 * A pack from anywhere else is imported by Project > Import pack…, which copies it into the project
 * as it always did. A listed pack's scripts run without the question Import pack asks: they are
 * this repository's own files, not somebody else's.
 *
 * Every entry a pack lays is the project's own copy, with a note of the pack it came from and of what
 * it said. An entry the editor has since changed - replaced, or changed where it stands - no longer
 * says what the pack said, so a save keeps it: it is the project's now.
 */

import { PACK_LISTS, readPack, type PackDocument, type PackList } from '../engine/content/pack/document';
import type { ProjectDoc } from '../engine/scene/schema';
import type { Edit } from '../editor/session';
import srdCharacters from '../engine/content/pack/shipped/srd-characters.json';

/** A pack a project can list: its name, and what it brings. */
export interface ListablePack {
  id: string;
  name: string;
  description: string;
}

export const LISTABLE_PACKS: readonly ListablePack[] = [
  {
    id: 'srd-characters',
    name: 'SRD characters',
    description: 'Every class, subclass, ancestry and community, and every domain card, with what they run',
  },
];

const SOURCES: Readonly<Record<string, unknown>> = { 'srd-characters': srdCharacters };
const read = new Map<string, PackDocument>();

/** A shipped pack, read once. Null for a name nothing ships. */
export function shippedPack(id: string): PackDocument | null {
  const known = read.get(id);
  if (known !== undefined) return known;
  const source = SOURCES[id];
  if (source === undefined) return null;
  const pack = readPack(source, id).pack;
  read.set(id, pack);
  return pack;
}

/** Where a laid entry came from, and what it said when it was laid. */
const laid = new WeakMap<object, { pack: string; said: string }>();

type Entry = { id: string };
const listOf = (project: ProjectDoc, list: PackList): Entry[] => project[list] as unknown as Entry[];

/** Lay one pack over the project's lists, in place. False when nothing ships under that name. */
function layPack(project: ProjectDoc, id: string): boolean {
  const pack = shippedPack(id);
  if (pack === null) return false;
  for (const list of PACK_LISTS) {
    const into = listOf(project, list);
    const own = new Set(into.map((entry) => entry.id));
    for (const entry of pack[list] as unknown as Entry[]) {
      if (own.has(entry.id)) continue;
      const copy = structuredClone(entry);
      laid.set(copy, { pack: id, said: JSON.stringify(copy) });
      into.push(copy);
    }
  }
  return true;
}

/** Take a pack's entries back out, in place - those it laid and that are as it laid them. */
function liftPack(project: ProjectDoc, id: string): void {
  for (const list of PACK_LISTS) {
    const into = listOf(project, list);
    for (let at = into.length - 1; at >= 0; at--) if (fromPack(into[at]!) === id) into.splice(at, 1);
  }
}

/** The pack an entry was laid by, while it still says what the pack said; null for the project's own. */
function fromPack(entry: object): string | null {
  const note = laid.get(entry);
  return note !== undefined && JSON.stringify(entry) === note.said ? note.pack : null;
}

/**
 * Lay every pack the project lists over it, in place, as it opens. What could not be laid - a name
 * nothing ships - is said, and the project opens without it.
 */
export function withListedPacks<P extends ProjectDoc>(project: P, problems: string[] = []): P {
  for (const id of project.packs) {
    if (!layPack(project, id)) problems.push(`This project lists a pack called "${id}", which this build does not have, so it opened without it.`);
  }
  return project;
}

/** The project as a file should hold it: without what its packs laid, which they will lay again. */
export function withoutPackEntries(project: ProjectDoc): ProjectDoc {
  const kept: Partial<Record<PackList, Entry[]>> = {};
  for (const list of PACK_LISTS) kept[list] = listOf(project, list).filter((entry) => fromPack(entry) === null);
  return { ...project, ...(kept as Partial<ProjectDoc>) };
}

/** List a pack, or stop listing it: its entries come or go with it, as one undo step. */
export function togglePack(id: string): Edit {
  let listed = false;
  return {
    label: 'Change the packs',
    apply(project) {
      listed = project.packs.includes(id);
      if (listed) {
        project.packs.splice(project.packs.indexOf(id), 1);
        liftPack(project, id);
      } else {
        project.packs.push(id);
        layPack(project, id);
      }
    },
    undo(project) {
      if (listed) {
        project.packs.push(id);
        layPack(project, id);
      } else {
        project.packs.splice(project.packs.indexOf(id), 1);
        liftPack(project, id);
      }
    },
  };
}
