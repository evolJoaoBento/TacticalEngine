/**
 * A content pack as a file somebody hands the editor.
 *
 * `contentPackSchema` is what a character is built from and what they are set against. A pack that
 * is only that is names and numbers: its cards arrive with no scripts, and a card that applies a
 * condition arrives without the condition. So the file a pack travels as carries two lists more --
 * the abilities that make its cards do something, and the conditions those abilities apply -- which
 * are exactly the two lists a project already carries for the same reason. A project file is
 * therefore a pack too: reading one takes its content and leaves its scenes.
 *
 * Reading one is a door like the project loader's. The raw document is migrated first, so a pack
 * written before a persisted name changed is rewritten on the way in rather than refused. After that
 * it differs on purpose. A project is one document and is either playable or not; a pack is a
 * catalogue, and one broken entry in two hundred is a reason to skip that entry, not the other one
 * hundred and ninety-nine. So each entry is validated on its own, and what could not be read comes
 * back as a `ContentIssue` -- importers never throw.
 */

import { z } from 'zod';
import { abilitySchema } from '../abilities';
import { conditionDefSchema } from '../conditions';
import { CURRENT_FORMAT_VERSION, migrateDocument } from '../../scene/migrate';
import type { ContentIssue } from '../types';
import {
  adversaryDefSchema,
  ancestryDefSchema,
  armorDefSchema,
  classDefSchema,
  communityDefSchema,
  contentPackSchema,
  domainCardDefSchema,
  subclassDefSchema,
  weaponDefSchema,
} from './schema';

/** Every list a pack file may carry, and the schema one entry of it is read against. */
const ENTRY = {
  weapons: weaponDefSchema,
  armors: armorDefSchema,
  classes: classDefSchema,
  ancestries: ancestryDefSchema,
  communities: communityDefSchema,
  subclasses: subclassDefSchema,
  cards: domainCardDefSchema,
  adversaries: adversaryDefSchema,
  abilities: abilitySchema,
  conditionDefs: conditionDefSchema,
} as const;

export type PackList = keyof typeof ENTRY;

/** Every list, in the order a summary names them. Each is also a list `projectSchema` carries. */
export const PACK_LISTS = Object.keys(ENTRY) as PackList[];

/**
 * The file format. Every list is defaulted, so a pack carries only what it has -- a file of nothing
 * but stat blocks is a pack.
 *
 * The version is optional because the packs exported before it existed carry none, and
 * `migrateDocument` reads its absence as version 1.
 */
export const packDocumentSchema = contentPackSchema.extend({
  formatVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  abilities: z.array(abilitySchema).default([]),
  conditionDefs: z.array(conditionDefSchema).default([]),
});

export type PackDocument = z.infer<typeof packDocumentSchema>;

/** What reading a pack file came to. */
export interface PackReading {
  /** Everything that could be read, list by list. */
  pack: PackDocument;
  /** Each entry that could not be, and why. The rest of its list still came through. */
  issues: ContentIssue[];
  /** Why the file as a whole is not a pack, or `null` when it is. A refused file brings nothing. */
  refused: string | null;
}

type Raw = Record<string, unknown>;

const isObject = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** An entry's id when it has one, so an issue names what the author would search for. */
const entryName = (entry: unknown, fallback: string): string =>
  isObject(entry) && typeof entry['id'] === 'string' ? entry['id'] : fallback;

/**
 * Read a raw document -- `JSON.parse` of a file -- as a pack.
 *
 * `source` names the file in every issue, so a message read later still says where it came from.
 */
export function readPack(raw: unknown, source = 'pack'): PackReading {
  const pack = packDocumentSchema.parse({});
  const issues: ContentIssue[] = [];
  const refuse = (reason: string): PackReading => ({ pack: packDocumentSchema.parse({}), issues, refused: reason });

  if (!isObject(raw)) return refuse('it is not a JSON object');
  // `migrateDocument` leaves a newer document untouched so that a whole-file schema can refuse it.
  // Entries are read one at a time here, so nothing would; it is refused by name instead, rather
  // than half-read by a build that cannot know what the newer names mean.
  const claimed = raw['formatVersion'];
  if (typeof claimed === 'number' && claimed > CURRENT_FORMAT_VERSION) {
    return refuse(`it was written by a newer build (format ${claimed}; this one reads up to ${CURRENT_FORMAT_VERSION})`);
  }
  const doc = migrateDocument(raw) as Raw;

  let offered = 0;
  for (const list of PACK_LISTS) {
    const entries = doc[list];
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) {
      issues.push({ source, entry: list, field: list, message: 'expected a list' });
      continue;
    }
    offered += entries.length;
    const schema: z.ZodType = ENTRY[list];
    entries.forEach((entry, index) => {
      const parsed = schema.safeParse(entry);
      if (parsed.success) {
        (pack[list] as unknown[]).push(parsed.data);
        return;
      }
      const first = parsed.error.issues[0];
      issues.push({
        source,
        entry: entryName(entry, `${list}[${index}]`),
        field: [list, index, ...(first?.path ?? [])].map(String).join('.'),
        message: first?.message ?? 'invalid',
      });
    });
  }

  if (offered === 0) return refuse(`it carries none of the lists a pack is made of (${PACK_LISTS.join(', ')})`);
  if (PACK_LISTS.every((list) => pack[list].length === 0)) {
    return refuse(`none of its ${offered} entries could be read`);
  }
  return { pack, issues, refused: null };
}

const NAMES: Readonly<Record<PackList, readonly [one: string, many: string]>> = {
  weapons: ['weapon', 'weapons'],
  armors: ['armor', 'armors'],
  classes: ['class', 'classes'],
  ancestries: ['ancestry', 'ancestries'],
  communities: ['community', 'communities'],
  subclasses: ['subclass', 'subclasses'],
  cards: ['card', 'cards'],
  adversaries: ['adversary', 'adversaries'],
  abilities: ['ability', 'abilities'],
  conditionDefs: ['condition', 'conditions'],
};

/** "3 classes, 1 card, 2 adversaries" -- what a pack holds, for a person to read. */
export function describePack(pack: PackDocument): string {
  const parts = PACK_LISTS.filter((list) => pack[list].length > 0).map((list) => {
    const count = pack[list].length;
    return `${count} ${NAMES[list][count === 1 ? 0 : 1]}`;
  });
  return parts.length === 0 ? 'nothing' : parts.join(', ');
}
