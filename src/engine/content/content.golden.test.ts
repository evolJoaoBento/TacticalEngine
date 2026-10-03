/**
 * The content schemas as the Rust server must read them (`docs/SERVER.md`, phase 2): what zod lets in,
 * what it puts in for what was left out, and - word for word, path for path - what it says about what it
 * turns away, since `readPack` shows the player zod's own messages.
 *
 * The corpus is the content the engine reads: the shipped SRD characters and the default project as they
 * are written (defaults left out), the starter pack and the equipment catalogue. Every entry is parsed as
 * it stands; then a few of each kind are broken at every field two levels down - taken away, nulled,
 * given the wrong type, emptied, made negative, fractional, too big for an integer, a bad id, a word not
 * in the set - and each break is parsed. Corners the corpus never reaches (refinements, unions, unknown
 * keys at every depth) are written out. Whole documents go through `readPack`, and the packs it reads
 * through `describePack`.
 *
 * Conditions, effects and a check's own fields are `script/`'s and not ported: the Rust passes them
 * through, so a case zod refuses only for something inside one of them is the script port's to hold.
 * `server/engine/tests/golden_content.rs` skips those, and counts them.
 * `UPDATE_GOLDEN=1 npx vitest run src/engine/content/content.golden.test.ts` writes
 * `server/fixtures/content.json` afresh.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { z } from 'zod';
import { abilitySchema } from './abilities';
import { conditionDefSchema } from './conditions';
import { EQUIPMENT } from './equipment/catalogue';
import { itemSchema, lootTableSchema } from './items';
import { describePack, packOf, readPack, PACK_LISTS } from './pack/document';
import {
  adversaryDefSchema, ancestryDefSchema, armorDefSchema, cardDefSchema, classDefSchema, communityDefSchema, experienceSchema, subclassDefSchema, weaponDefSchema,
} from './pack/schema';
import { STARTER_ABILITIES, STARTER_CONDITIONS, STARTER_PACK } from './pack/starter';
import { questSchema } from './quests';
import { codeSchema } from '../scene/schema';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, '../../../server/fixtures/content.json');
const readJson = (path: string): Record<string, unknown[]> => JSON.parse(readFileSync(resolve(HERE, path), 'utf8')) as Record<string, unknown[]>;

const SCHEMAS: Record<string, z.ZodType> = {
  weapon: weaponDefSchema,
  armor: armorDefSchema,
  class: classDefSchema,
  ancestry: ancestryDefSchema,
  community: communityDefSchema,
  subclass: subclassDefSchema,
  card: cardDefSchema,
  experience: experienceSchema,
  adversary: adversaryDefSchema,
  ability: abilitySchema,
  conditionDef: conditionDefSchema,
  code: codeSchema,
  item: itemSchema,
  lootTable: lootTableSchema,
  quest: questSchema,
};

/** Which list of a document holds which kind. */
const LISTS: Record<string, string> = {
  weapons: 'weapon', armors: 'armor', classes: 'class', ancestries: 'ancestry', communities: 'community', subclasses: 'subclass',
  cards: 'card', adversaries: 'adversary', abilities: 'ability', conditionDefs: 'conditionDef', code: 'code', items: 'item', lootTables: 'lootTable', quests: 'quest',
};

function corpus(): Record<string, unknown[]> {
  const srd = readJson('pack/shipped/srd-characters.json');
  const project = readJson('../../../projects/default.json');
  const byKind: Record<string, unknown[]> = Object.fromEntries(Object.keys(SCHEMAS).map((kind) => [kind, []]));
  const add = (doc: Record<string, unknown>): void => {
    for (const [list, kind] of Object.entries(LISTS)) if (Array.isArray(doc[list])) byKind[kind]!.push(...(doc[list] as unknown[]));
  };
  add(srd);
  add(project);
  add(STARTER_PACK as never);
  add({ abilities: STARTER_ABILITIES, conditionDefs: STARTER_CONDITIONS });
  add(EQUIPMENT as never);
  byKind['experience']!.push(...(byKind['adversary']!.flatMap((a) => (a as { experiences?: unknown[] }).experiences ?? [])));
  return byKind;
}

type Path = (string | number)[];

/** Every place in an entry worth breaking: its fields, and theirs, and an array's first item's. */
function placesIn(value: unknown, depth = 0, at: Path = []): Path[] {
  if (depth > 2 || value === null || typeof value !== 'object') return [];
  const places: Path[] = [];
  if (Array.isArray(value)) {
    if (value.length > 0) places.push([...at, 0], ...placesIn(value[0], depth + 1, [...at, 0]));
    return places;
  }
  for (const [key, inner] of Object.entries(value)) places.push([...at, key], ...placesIn(inner, depth + 1, [...at, key]));
  return places;
}

/** What a place is broken with: `delete`, or a value put there. */
const BREAKS: unknown[] = ['delete', null, 'zzz', 7, true, [], {}, '', -1, 1.5, 2 ** 60, 'Bad-Id'];

function broken(entry: unknown, path: Path, change: unknown): unknown {
  const copy = structuredClone(entry) as Record<string | number, unknown>;
  let parent: Record<string | number, unknown> = copy;
  for (const key of path.slice(0, -1)) parent = parent[key] as Record<string | number, unknown>;
  const last = path[path.length - 1]!;
  if (change === 'delete') {
    if (Array.isArray(parent)) parent.splice(last as number, 1);
    else delete parent[last];
  } else parent[last] = structuredClone(change);
  return copy;
}

function verdict(schema: z.ZodType, value: unknown) {
  const result = schema.safeParse(value);
  return result.success ? { ok: result.data } : { issues: result.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) };
}

/** A few of each kind to break: the two longest written, and the first two. */
function samples(entries: readonly unknown[]): unknown[] {
  const longest = [...entries].sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length).slice(0, 2);
  return [...new Set([...longest, ...entries.slice(0, 2)])];
}

function golden() {
  const byKind = corpus();
  const entries = Object.entries(byKind).map(([kind, list]) => ({ kind, cases: list.map((value) => ({ value, ...verdict(SCHEMAS[kind]!, value) })) }));

  const breaks = Object.entries(byKind).map(([kind, list]) => ({
    kind,
    samples: samples(list).map((sample) => ({
      sample,
      cases: placesIn(sample).flatMap((path) => BREAKS.map((change) => ({ path, change, ...verdict(SCHEMAS[kind]!, broken(sample, path, change)) }))),
    })),
  }));

  // Corners the corpus never reaches: refinements, unions, the bounds of an integer.
  const card = { id: 'c', name: 'C', grant: { kind: 'chosen' }, domain: 'd', type: 'spell', level: 1, recallCost: 0 };
  const corners: { kind: string; value: unknown }[] = [
    { kind: 'card', value: { id: 'c', name: 'C' } },
    { kind: 'card', value: { ...card, name: '', level: undefined } },
    { kind: 'card', value: { ...card, grant: { kind: 'class' } } },
    { kind: 'card', value: { ...card, grant: { kind: 'nope' }, level: 0 } },
    { kind: 'card', value: { ...card, grant: { kind: 'given', characters: ['a', 'B'] } } },
    { kind: 'lootTable', value: { id: 't', entries: [{ item: 'a', quantity: { min: 3, max: 2 } }, { item: 'b', quantity: { min: 1, max: 1 } }, { item: 'c', quantity: { min: 5, max: 1.5 } }] } },
    { kind: 'lootTable', value: { id: 't', entries: [] } },
    { kind: 'lootTable', value: { id: 't', rolls: 0, entries: [{ item: 'a', quantity: 0, weight: 0 }, { item: 'b', quantity: 'many' }, { item: 'c', quantity: { min: 0 } }, { item: 'd', weight: 0.25 }] } },
    { kind: 'quest', value: { id: 'q', name: 'Q', objectives: [{ id: 'o', text: 'x' }, { id: 'p', text: 'y' }, { id: 'o', text: 'z' }, { id: 'p', text: '' }] } },
    { kind: 'quest', value: { id: 'q', name: 'Q', objectives: [] } },
    { kind: 'ability', value: { id: 'a', name: 'A', source: { card: 'c' }, modifiers: [{ stat: 'evasion', against: true, anyRoll: true }, { stat: 'advantage', against: true }, { stat: 'evasion', bonus: 1.5, against: true }] } },
    { kind: 'ability', value: { id: 'a', name: 'A', source: { card: 'c' }, tokens: { amount: 'luck' } } },
    { kind: 'ability', value: { id: 'a', name: 'A', source: { card: 'c' }, tokens: { amount: -1 } } },
    { kind: 'ability', value: { id: 'a', name: 'A', source: { card: 'c' }, tokens: { amount: 'spellcast' }, lift: {}, uses: { per: 'rest' }, target: { kind: 'group' } } },
    { kind: 'ability', value: { id: 'a', name: 'A', source: { card: 'c' }, reaction: { kind: 'reroll' }, defenses: { reduce: [{ dice: '' }, { dice: '1d4', only: 'fire' }] } } },
    { kind: 'ability', value: { id: 'a', name: 'A', source: { card: 'c' }, reaction: { kind: 'reduceSeverity', steps: 0 } } },
    { kind: 'ability', value: { id: 'a', name: 'A', source: {} } },
    { kind: 'adversary', value: { id: 'x', name: 'X', tier: 5, role: 'boss', difficulty: 0, thresholds: { major: -1, severe: 1.5 }, hitPoints: 1, stress: 0, attackName: 'hit', attackModifier: { count: 0, sides: 0, modifier: 2 }, attackRange: 'far', attackDamage: { count: 1, sides: 6, modifier: 0, types: ['fire'] } } },
    { kind: 'conditionDef', value: { id: 'c', name: 'C', color: '#ABC' } },
    { kind: 'conditionDef', value: { id: 'c', name: 'C', color: '#abcd', goodDie: { sides: 1 }, blocks: ['act', 'sleep'], insteadOfDeath: { clears: 0, says: '' }, armor: {}, payout: { on: 'hit' } } },
    { kind: 'weapon', value: { id: 'w', name: 'W', tier: 9007199254740993, slot: 'secondary', trait: 'luck', range: 'outOfRange', damage: { count: -0, sides: 6, modifier: -3 }, burden: 'oneHanded' } },
    { kind: 'class', value: { id: 'k', name: 'K', startingEvasion: -9007199254740993, startingHitPoints: 0 } },
    { kind: 'code', value: { id: 'x' } },
    { kind: 'code', value: { id: 'x', junk: 1, name: 'n' } },
    { kind: 'card', value: { ...card, junk: true, grant: { kind: 'class', classId: 'k', junk: 2 }, features: [{ name: 'f', text: 't', junk: 3 }] } },
    { kind: 'ability', value: { id: 'a', name: 'A', source: { card: 'c', junk: 1 }, target: { kind: 'self', junk: 2 }, modifiers: [{ stat: 'evasion', junk: 3 }], cost: { good: 1, junk: 4 } } },
    { kind: 'lootTable', value: { id: 't', entries: [{ item: 'a', quantity: { min: 2, max: 2, junk: 1 }, junk: 2 }] } },
    { kind: 'lootTable', value: { id: 't', entries: [{ item: 'a', quantity: { min: 2, max: 2 } }, { item: 'b', quantity: { min: 4, max: 3 } }] } },
    { kind: 'experience', value: { name: '', modifier: 1.5 } },
  ].map(({ kind, value }) => ({ kind, value: JSON.parse(JSON.stringify(value)) as unknown }));

  const srd = readJson('pack/shipped/srd-characters.json');
  const project = readJson('../../../projects/default.json');
  const documents: { source: string; value: unknown }[] = [
    { source: 'srd-characters', value: srd },
    { source: 'default project', value: project },
    { source: 'nothing', value: 'a pack' },
    { source: 'a list', value: [srd] },
    { source: 'null', value: null },
    { source: 'newer', value: { formatVersion: 7, cards: [] } },
    { source: 'far newer', value: { formatVersion: 12.5 } },
    { source: 'empty', value: { formatVersion: 6 } },
    { source: 'no lists', value: { formatVersion: 6, scenes: [], weapons: 'three' } },
    { source: 'nothing readable', value: { formatVersion: 6, cards: [{ id: 'Bad' }, 7, { name: 'no id' }], code: [{}] } },
    { source: 'mixed', value: { formatVersion: 6, weapons: [...(STARTER_PACK.weapons as unknown[]).slice(0, 2), { id: 'broken-bow', name: '' }], armors: 'none', cards: [{ id: 3 }, ...(srd['cards'] ?? []).slice(0, 3)], code: [{ id: 'x', source: 'return 1' }] } },
    { source: 'current', value: { formatVersion: 6, conditionDefs: (srd['conditionDefs'] ?? []).slice(0, 4), abilities: [{ id: 'a', name: 'A', source: { card: 'c' } }], adversaries: STARTER_PACK.adversaries } },
  ];
  const readings = documents.map(({ source, value }) => {
    const reading = readPack(value, source);
    return { source, value: source === 'srd-characters' || source === 'default project' ? source : value, reading, described: describePack(reading.pack) };
  });
  const packed = packOf(Object.fromEntries(PACK_LISTS.map((list) => [list, readings[0]!.reading.pack[list].slice(0, 2)])) as never);

  return {
    about: 'src/engine/content schemas read for the Rust port; written by src/engine/content/content.golden.test.ts',
    entries,
    breaks,
    corners: corners.map(({ kind, value }) => ({ kind, value, ...verdict(SCHEMAS[kind]!, value) })),
    readings,
    packed: { pack: packed, described: describePack(packed) },
  };
}

describe('the content schemas, as the Rust server must read them', () => {
  it('are what server/fixtures/content.json holds', () => {
    const now = JSON.parse(JSON.stringify(golden())) as unknown;
    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(now)}\n`, 'utf8');
    }
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(now);
  });
});
