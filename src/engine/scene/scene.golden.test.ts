/**
 * Scene and project documents as the Rust server must read them (`docs/SERVER.md`, phase 2).
 *
 * The door every stored document comes through is `migrateDocument`, then `projectSchema`; a pack comes
 * through `readPack`, which migrates too. This takes the documents older builds really wrote - the
 * captured version-1 project and save, the version-3 project - and the default project with its version
 * taken off, so every step walks real data, and documents written here for each step's corners; migrates
 * them; reads the projects whole and as packs; breaks a sample project that uses every part of the
 * schema twelve ways at every place worth breaking, deeper inside a scene; and adds the corners the
 * breaks cannot reach. `UPDATE_GOLDEN=1 npx vitest run src/engine/scene/scene.golden.test.ts` writes
 * `server/fixtures/scene.json`; `server/engine/tests/golden_scene.rs` replays it.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toContentId } from '../content/types';
import { describePack, readPack } from '../content/pack/document';
import { migrateDocument } from './migrate';
import { projectSchema } from './schema';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, '../../../server/fixtures/scene.json');
const repo = (path: string): unknown => JSON.parse(readFileSync(resolve(here, '../../..', path), 'utf8'));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;

type Path = (string | number)[];
type Raw = Record<string, unknown>;

// --- Migrations ---------------------------------------------------------------------------------------

/** A document read from the repository, and what is done to it before it is migrated. */
interface FromFile {
  file: string;
  prep: 'as is' | 'unversioned';
}

function prepared({ file, prep }: FromFile): unknown {
  const doc = repo(file) as Raw;
  if (prep === 'unversioned') delete doc['formatVersion'];
  return doc;
}

const FILES: FromFile[] = [
  { file: 'tests/fixtures/v1/project.json', prep: 'as is' },
  { file: 'tests/fixtures/v1/save.json', prep: 'as is' },
  { file: 'tests/fixtures/v3/project.json', prep: 'as is' },
  { file: 'projects/default.json', prep: 'unversioned' },
  { file: 'projects/default.json', prep: 'as is' },
  { file: 'src/engine/content/pack/shipped/srd-characters.json', prep: 'as is' },
];

/** Documents written for each step's corners. */
const WRITTEN: unknown[] = [
  null,
  [],
  'text',
  7,
  { formatVersion: 7, hope: 1 },
  { formatVersion: '6', hope: 1 },
  { formatVersion: 2.5, domainCards: [{ id: 'x' }] },
  { formatVersion: 1, hope: 2, nested: [{ fear: 'hope', words: ['hope'], hopeDie: 12, check: { onSuccessWithHope: [], onFailureWithFear: [{ kind: 'gainFear' }] } }], good: 'kept', tone: 'withHope' },
  // Version 3: cards made of sources and of what classes, subclasses, ancestries and communities printed.
  {
    formatVersion: 2,
    domainCards: [{ id: 'spark', name: 'Spark' }],
    abilities: [
      { id: 'spark', name: 'Spark', source: { kind: 'domainCard', card: 'spark' } },
      { id: 'rally', name: 'Rally', text: 'Rally them.', source: { kind: 'classGood', classId: 'bard' } },
      { id: 'song', source: { kind: 'classFeature', classId: 'bard' } },
      { id: 'blade', name: 'Blade Dance', source: { kind: 'subclass', subclassId: 'wordsmith', stage: 'foundation' } },
      { id: 'gift', name: 'Gift', source: { kind: 'granted', characters: ['kara'] } },
      { id: 'claw', name: 'Claw', source: { kind: 'adversary', adversaries: ['rat'] } },
      { id: 'odd', name: 'Odd', source: { kind: 'nothing' } },
      { id: 'bare', name: 'Bare', source: 'text' },
      { id: 'spark', name: 'Spark Again', source: { kind: 'granted' } },
      'not an ability',
    ],
    classes: [
      { id: 'bard', name: 'Bard', features: [{ name: 'song', text: 'Sing.' }, { name: 'Café Ⅻ ﬁre', text: 'Warm.' }, { text: 'nameless' }], signatureFeature: { name: 'Rally', text: 'Lead.' } },
      { id: 'mute', features: 'none' },
    ],
    subclasses: [{ id: 'wordsmith', foundation: [{ name: 'Blade Dance', text: 'Twirl.' }], specialization: [{ name: '!!!' }], mastery: 'x' }],
    ancestries: [{ id: 'elf', features: [{ name: 'Sight', text: 'See.' }, { name: 'Sight', text: 'Again.' }] }],
    communities: [{ id: 'wayfarer', features: [{ name: 'Roads' }] }, 3],
  },
  { formatVersion: 2, cards: { not: 'a list' }, classes: [{ id: 'c', features: [{ name: 'f' }] }] },
  { formatVersion: 2, abilities: [{ id: 5, source: { kind: 'classGood' } }] },
  // Version 4: a condition that lent an ability becomes a card it grants.
  {
    formatVersion: 3,
    abilities: [
      { id: 'ward', name: 'Ward', text: 'Protect.', source: { card: 'ward-card' } },
      { id: 'ward-2', source: { card: 'ward-card' } },
      { id: 'lone', name: 'Lone', source: { card: 'lone-card' } },
      { id: 'lone-lent', source: { card: 'other' } },
      { id: 'loose' },
    ],
    cards: [{ id: 'ward', name: 'taken' }, { id: 'lone-lent' }],
    conditionDefs: [
      { id: 'warded', grants: { ability: 'ward' } },
      { id: 'blessed', grants: { ability: 'ward' } },
      { id: 'alone', grants: { ability: 'lone' } },
      { id: 'loosed', grants: { ability: 'loose' } },
      { id: 'ghost', grants: { ability: 'nobody' } },
      { id: 'numbered', grants: { ability: 5 } },
      { id: 'plain' },
    ],
  },
  { formatVersion: 3, conditionDefs: [{ id: 'x', grants: 'ward' }] },
  // Version 5: a save of the husk vault from before rooms grew.
  { formatVersion: 4, scenes: { 'the-husk-vault': { entities: {} }, other: { entities: {} } } },
  { formatVersion: 4, scenes: { 'the-husk-vault': { room: { width: 30, x: 1, y: 2 } } } },
  { formatVersion: 4, scenes: [{ id: 'the-husk-vault' }] },
  // Version 6: a room's objects become props with a Script function.
  {
    formatVersion: 5,
    scenes: [
      {
        id: 'room',
        decos: [{ id: 'tree', model: 'tree', position: { x: 0, y: 0 } }],
        interactables: [
          { id: 'door-1', kind: 'door', position: { x: 1, y: 1 }, rotation: 90, name: 'Door', toggles: true, effects: [{ kind: 'open' }] },
          { id: 'box', kind: 'chest', model: 'crate', position: { x: 2, y: 1 }, object: 'overwritten', repeatable: true },
          { id: 'hidden', kind: 'scripted', position: { x: 3, y: 1 }, flavor: 'Nothing to see.' },
          { id: 'odd', position: { x: 4, y: 1 }, rotation: 'north', model: null },
          { id: 'turned', kind: 'pillar', position: { x: 5, y: 1 }, rotation: 'north' },
          { kind: 'portal' },
          'not an object',
        ],
      },
      { id: 'bare' },
      { id: 'no-decos', decos: 'x', interactables: [{ id: 'p', kind: 'pillar', position: { x: 0, y: 0 } }] },
      'not a scene',
    ],
  },
];

// --- Breaking a project ---------------------------------------------------------------------------------

const DEFAULT = repo('projects/default.json') as Raw;
const first = (list: string): unknown[] => ((DEFAULT[list] as unknown[] | undefined) ?? []).slice(0, 1);

/** A small project using every part of the schema, valid as it stands. */
const SAMPLE: Raw = {
  formatVersion: 6,
  id: 'sample',
  name: 'Sample',
  terrainPalette: [{ id: 'grass' }, { id: 'wall', passable: false, cost: 2, providesCover: true, blocksSight: true, color: '#333', model: 'wall', scale: 1.5, structure: 'block' }],
  structureTypes: [{ id: 'arch', name: 'Arch', atoms: [{ shape: 'wall', at: [0, 0.5, 0] }, { shape: 'floor' }] }],
  propPresets: [{ id: 'crate', label: 'Crate', model: 'crate', span: 2, rotation: 1.5, solid: true, function: { kind: 'container', items: [{ item: 'rope' }] } }],
  scenes: [
    {
      id: 'room',
      name: 'Room',
      intro: 'In.',
      width: 3,
      height: 2,
      terrain: ['grass', 'grass', 'wall', 'grass', 'grass', 'grass'],
      heights: [0, 0, 1, 0, 0, 0],
      tints: ['', '', '', '', '', '#fff'],
      spawns: [{ x: 0, y: 0 }],
      interactables: [{ id: 'lever', kind: 'scripted', position: { x: 1, y: 1, z: 0.5 }, effects: [{ kind: 'setFlag', flag: 'f' }], check: { trait: 'agility', difficulty: 10 }, data: { lit: true, n: 2, s: 'x' } }],
      encounters: [
        {
          id: 'fight',
          name: 'Fight',
          adversaries: [
            { id: 'rat-1', adversary: 'rat', position: { x: 2, y: 1 }, name: 'Rat', hitPoints: 3, model: 'rat', interaction: { kind: 'threshold', dialogue: 'talk', percent: 40, shop: { stock: [{ item: 'rope', price: 3, count: 2 }], buysAt: 50 } } },
            { id: 'rat-2', adversary: 'rat', position: { x: 2, y: 0 }, interaction: { kind: 'friendly', dialogue: 'talk' } },
          ],
          triggerCells: [{ x: 1, y: 0 }],
          startsOnTrigger: false,
          bystanders: true,
        },
      ],
      decos: [
        { id: 'chest', model: 'chest-prop', position: { x: 0, y: 1 }, rotation: 90, span: 1, solid: true, function: { kind: 'container', items: [{ item: 'rope', count: 2 }] } },
        { id: 'door', model: 'door-prop', position: { x: 1, y: 0 }, function: { kind: 'door' } },
        { id: 'gate', model: 'portal-prop', position: { x: 2, y: 0 }, function: { kind: 'portal', pair: '  far  ' } },
        { id: 'bard', model: 'npc', position: { x: 0, y: 0 }, function: { kind: 'interaction', dialogue: ' talk ' } },
        { id: 'stall', model: 'stall', position: { x: 1, y: 1 }, function: { kind: 'shop' } },
        { id: 'trap', model: 'plate', position: { x: 2, y: 1 }, function: { kind: 'trapped', trait: 'finesse', difficulty: 14, success: { kind: 'door' }, failure: { kind: 'script', effects: [{ kind: 'damage', amount: 1 }], name: 'Spikes' } } },
        { id: 'altar', model: 'altar', position: { x: 0, y: 1 }, function: { kind: 'script', object: 'pillar', name: 'Altar', check: { trait: 'presence', difficulty: 12 }, requiresKey: 'k', goto: 'room', tags: ['holy'], data: { lit: false } } },
        { model: 'tree', position: { x: -5, y: 7, z: -0.25 } },
      ],
      buildingTiles: {
        '0,0,0': { x: 0, y: 0, level: 0, shape: 'floor', material: 'stone', rotation: 0, tile: 'grass' },
        '0,0,0#2': { x: 0, y: 0, level: 0, shape: 'arch', material: 'wood', rotation: 1, height: 1.25 },
        '1,0,0.25': { x: 1, y: 0, level: 0.25, shape: 'stairs', material: 'grass', rotation: 3 },
      },
      fogBand: 4,
      origin: { x: -2, y: 3 },
    },
  ],
  dialogues: first('dialogues'),
  items: first('items'),
  lootTables: first('lootTables'),
  quests: first('quests'),
  assets: [{ id: 'rat', url: 'rat.glb', scale: 0.5, clips: { idle: 'Idle', walk: 'Walk' }, pivot: 'file' }, ...first('assets')],
  adversaryModels: { rat: 'rat' },
  cards: first('cards'),
  weapons: first('weapons'),
  adversaries: first('adversaries'),
  abilities: first('abilities'),
  code: first('code'),
  conditionDefs: first('conditionDefs'),
  packs: ['srd-characters'],
  party: [
    {
      id: 'kara',
      name: 'Kara',
      level: 3,
      classId: 'sentinel',
      ancestryId: 'stoneborn',
      traits: { agility: 0, strength: 2, finesse: 0, instinct: 1, presence: 1, knowledge: -1 },
      proficiency: 1,
      experiences: [{ name: 'Held the line', modifier: 2 }],
      bonuses: { evasion: 1, stress: 1 },
      domainCards: ['a'],
      loadout: ['a'],
      levels: [
        { level: 2, advancements: [{ kind: 'traits', traits: ['agility', 'strength'] }, { kind: 'experiences', names: ['a', 'b'], fromTier: 1 }], domainCard: 'x', experience: { name: 'e', modifier: 1 } },
        { level: 3, advancements: [{ kind: 'multiclass', classId: 'c', domain: 'd' }, { kind: 'proficiency', fromTier: 2 }], domainCard: 'y' },
      ],
      scars: 0,
      model: 'kara',
    },
  ],
  jump: { enabled: true, difficulty: 10, reachTrait: 'agility', stepHeight: 0.5 },
  startScene: 'room',
};

/** How deep each part of the project is broken: a scene furthest, since it is what this port adds. */
const DEPTH: Record<string, number> = { scenes: 6, party: 5, structureTypes: 4, propPresets: 5, assets: 3, terrainPalette: 3, jump: 2, adversaryModels: 2 };

function placesIn(value: unknown, left: number, at: Path): Path[] {
  if (left <= 0 || value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.length === 0 ? [] : [[...at, 0], ...placesIn(value[0], left - 1, [...at, 0])];
  return Object.entries(value).flatMap(([key, inner]) => [[...at, key], ...placesIn(inner, left - 1, [...at, key])]);
}

function places(project: Raw): Path[] {
  return Object.entries(project).flatMap(([key, value]) => [[key], ...placesIn(value, DEPTH[key] ?? 1, [key])]);
}

const BREAKS: unknown[] = ['delete', null, 'zzz', 7, true, [], {}, '', -1, 1.5, 2 ** 60, 'Bad-Id'];

function broken(value: unknown, path: Path, change: unknown): unknown {
  const copy = structuredClone(value) as Record<string | number, unknown>;
  let parent: Record<string | number, unknown> = copy;
  for (const key of path.slice(0, -1)) parent = parent[key] as Record<string | number, unknown>;
  const last = path[path.length - 1]!;
  if (change === 'delete') {
    if (Array.isArray(parent)) parent.splice(last as number, 1);
    else delete parent[last];
  } else parent[last] = structuredClone(change);
  return copy;
}

const issuesOf = (error: { issues: { path: PropertyKey[]; message: string }[] }) => error.issues.map((issue) => ({ path: issue.path, message: issue.message }));

/** Whether it reads, and if not what zod says. What it reads to is kept only where asked. */
function verdict(value: unknown, keep = false) {
  const result = projectSchema.safeParse(value);
  if (result.success) return keep ? { ok: result.data } : { ok: true };
  return { issues: issuesOf(result.error) };
}

/** Changes the breaks cannot make: refinements, defaults, the new check on structures. */
function corners(): { name: string; value: unknown }[] {
  const scene = (SAMPLE['scenes'] as Raw[])[0]!;
  const withScene = (change: Raw): Raw => ({ ...SAMPLE, scenes: [{ ...scene, ...change }] });
  const tiles = (entries: Raw): Raw => withScene({ buildingTiles: entries });
  const tile = { x: 1, y: 2, level: 0.5, shape: 'block', material: 'stone', rotation: 0 };
  return [
    { name: 'the sample', value: SAMPLE },
    { name: 'no structure of that name', value: tiles({ '1,2,0.5': { ...tile, shape: 'doorway' } }) },
    { name: 'a structure the project declares', value: { ...tiles({ '1,2,0.5': { ...tile, shape: 'doorway' } }), structureTypes: [{ id: 'doorway', atoms: [{ shape: 'wall' }] }] } },
    { name: 'keys that do not match', value: tiles({ '1,2,0': tile, '1,2,0.5#0': tile, '1,2,0.5#01': tile, '1,2,0.5#1#2': tile, '1,2,0.5#1': tile, '1,2,0.5#': tile, '1,2,.5': tile }) },
    { name: 'quarter steps', value: tiles({ '1,2,0.3': { ...tile, level: 0.3, height: 0.1 }, '1,2,1e-7': { ...tile, level: 1e-7 }, '1,2,-0': { ...tile, level: -0 } }) },
    { name: 'a place off the quarter', value: withScene({ decos: [{ model: 'm', position: { x: 0, y: 0, z: 0.1 } }] }) },
    { name: 'a place past the limit', value: withScene({ decos: [{ model: 'm', position: { x: 1_000_001, y: -1_000_001, z: 2_000_000.3 } }] }) },
    { name: 'lengths that do not match', value: withScene({ terrain: ['grass'], heights: [0, 0, 0, 0, 0, 0, 0], tints: [] }) },
    { name: 'spawns outside', value: withScene({ spawns: [{ x: 3, y: 0 }, { x: 0, y: 2 }, { x: 2, y: 1 }] }) },
    { name: 'no spawns', value: withScene({ spawns: [] }) },
    {
      name: 'duplicate ids in a scene',
      value: withScene({
        interactables: [{ id: 'dup', kind: 'door', position: { x: 0, y: 0 } }, { id: 'dup', kind: 'chest', position: { x: 0, y: 0 } }],
        decos: [{ id: 'dup', model: 'm', position: { x: 0, y: 0 }, function: { kind: 'door' } }, { model: 'm', position: { x: 0, y: 0 }, function: { kind: 'door' } }, { id: 'dup', model: 'm', position: { x: 0, y: 0 } }],
        encounters: [{ id: 'dup', adversaries: [{ id: 'dup', adversary: 'rat', position: { x: 0, y: 0 } }, { id: 'e2', adversary: 'rat', position: { x: 0, y: 0 } }] }, { id: 'e2' }],
      }),
    },
    {
      name: 'duplicate ids in a project',
      value: {
        ...SAMPLE,
        scenes: [scene, { ...scene }],
        dialogues: [...first('dialogues'), ...first('dialogues')],
        items: [...first('items'), ...first('items')],
        assets: [{ id: 'a', url: 'a' }, { id: 'a', url: 'b' }],
        quests: [...first('quests'), ...first('quests')],
        party: [...(SAMPLE['party'] as unknown[]), ...(SAMPLE['party'] as unknown[])],
        abilities: [...first('abilities'), ...first('abilities')],
        lootTables: [...first('lootTables'), ...first('lootTables')],
        startScene: 'elsewhere',
      },
    },
    { name: 'a start scene that is not there', value: { ...SAMPLE, startScene: 'elsewhere' } },
    { name: 'the fewest fields', value: { id: 'p', scenes: [{ id: 's', width: 1, height: 1, terrain: ['grass'], heights: [0], spawns: [{ x: 0, y: 0 }] }], startScene: 's' } },
    { name: 'versions', value: { ...SAMPLE, formatVersion: 7 } },
    { name: 'a version as text', value: { ...SAMPLE, formatVersion: '6' } },
    { name: 'the oldest version', value: { ...SAMPLE, formatVersion: 1 } },
    { name: 'defaults everywhere', value: withScene({ encounters: [{ id: 'e', adversaries: [{ id: 'a', adversary: 'rat', position: { x: 0, y: 0 }, interaction: { kind: 'threshold', dialogue: 'd' } }] }], decos: [{ id: 'f', model: 'm', position: { x: 0, y: 0 }, function: { kind: 'shop' } }, { id: 'g', model: 'm', position: { x: 0, y: 0 }, function: { kind: 'script' } }, { id: 'h', model: 'm', position: { x: 0, y: 0 }, function: { kind: 'trapped', trait: 'weapon' } }, { id: 'i', model: 'm', position: { x: 0, y: 0 }, function: { kind: 'portal' } }] }) },
    { name: 'a trap that springs a trap', value: withScene({ decos: [{ id: 't', model: 'm', position: { x: 0, y: 0 }, function: { kind: 'trapped', trait: 'spellcast', difficulty: 41, success: { kind: 'trapped', trait: 'nope', failure: { kind: 'nothing' } } } }] }) },
    { name: 'a sheet worth reading', value: { ...SAMPLE, party: [{ id: '', name: 3, level: 11, classId: '', traits: { agility: 1.5 }, proficiency: 0, levels: [{ level: 1, advancements: [{ kind: 'traits', traits: ['agility'] }, { kind: 'experiences', names: ['a', 'b', 'c'] }, { kind: 'nope' }, { kind: 'evasion', fromTier: 5 }], domainCard: 3 }], scars: -1 }] } },
    { name: 'jump rules out of bounds', value: { ...SAMPLE, jump: { stepHeight: 17, difficulty: 0, fallDie: 101, reachTrait: 'luck', harderEvery: -1 } } },
    { name: 'jump rules all defaulted', value: { ...SAMPLE, jump: {} } },
    { name: 'pairs too short and wrong', value: { ...SAMPLE, party: [{ ...(SAMPLE['party'] as Raw[])[0]!, levels: [{ level: 2, advancements: [{ kind: 'traits', traits: [7] }, { kind: 'experiences', names: [false] }], domainCard: 'x' }] }], structureTypes: [{ id: 'x', atoms: [{ shape: 'wall', at: ['a', 2] }] }] } },
    { name: 'a structure made of nothing', value: { ...SAMPLE, structureTypes: [{ id: '', atoms: [] }, { id: 'x', atoms: [{ shape: 'wall', at: [0, 0] }, { shape: 'wall', at: [0, 0, 0, 0] }, { shape: '', at: 'here' }] }] } },
    { name: 'assets and models', value: { ...SAMPLE, assets: [{ id: 'm', url: '', kind: 'obj', scale: 0, clips: { idle: '' }, pivot: 'middle' }], adversaryModels: { rat: '' } } },
  ];
}

const NAMES = ['Sight', 'Café Noir', 'Ⅻ ﬁre', '  --Leading and trailing--  ', '!!!', '', 'Ünïcødé ÅÆØ', 'Straße', 'ΣΊΣΥΦΟΣ', 'x_y z', 'Ｆｕｌｌｗｉｄｔｈ', 'İstanbul', '½ measure', 'áb'];

function golden() {
  const migrations = [
    ...FILES.map((source) => {
      const input = prepared(source);
      const output = migrateDocument(input);
      // A document already current comes back as it went in: said once, not written out twice.
      return JSON.stringify(output) === JSON.stringify(input) ? { source, unchanged: true } : { source, output };
    }),
    ...WRITTEN.map((input) => ({ input, output: migrateDocument(input) })),
  ];
  const projects = [
    { file: 'tests/fixtures/v1/project.json', prep: 'as is' },
    { file: 'tests/fixtures/v3/project.json', prep: 'as is' },
    { file: 'projects/default.json', prep: 'as is' },
  ].map((source) => ({ source, ...verdict(migrateDocument(prepared(source as FromFile)), true) }));
  const packs = ['tests/fixtures/v1/project.json', 'tests/fixtures/v3/project.json', 'tests/fixtures/v1/save.json'].map((file) => {
    const reading = readPack(repo(file), file);
    return { file, reading, described: describePack(reading.pack) };
  });
  const breaks = places(SAMPLE).flatMap((path) => BREAKS.map((change) => ({ path, change, ...verdict(broken(SAMPLE, path, change)) })));
  return {
    about: 'src/engine/scene/migrate.ts and schema.ts read for the Rust port; written by src/engine/scene/scene.golden.test.ts',
    migrations,
    projects,
    packs,
    sample: SAMPLE,
    breaks,
    corners: corners().map(({ name, value }) => ({ name, value, ...verdict(value, true) })),
    ids: NAMES.map((name) => ({ name, id: toContentId(name) })),
  };
}

describe('scene and project documents, as the Rust server must read them', () => {
  it('are what server/fixtures/scene.json holds', () => {
    const now = clone(golden());
    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(now)}\n`, 'utf8');
    }
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(now);
  }, 120_000);
});
