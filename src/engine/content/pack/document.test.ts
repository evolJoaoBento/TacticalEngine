import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { cardOf } from '../abilities';
import { PACK_LISTS, describePack, packDocumentSchema, packOf, readPack } from './document';
import { STARTER_ABILITIES, STARTER_CONDITIONS, STARTER_PACK } from './starter';
import { CURRENT_FORMAT_VERSION } from '../../scene/migrate';
import { compileHooks } from '../../script/hooks';
import { blankScene } from '../../scene/grid-from-scene';
import { projectSchema, sceneSchema } from '../../scene/schema';

/**
 * Reading a pack file: the door the editor's Import pack goes through. Tested on the one genuine
 * old document the repository has, and -- where a machine has it -- on the export it exists to
 * bring back.
 */

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const json = (relative: string): unknown => JSON.parse(readFileSync(`${repoRoot}${relative}`, 'utf8'));

const AXE = {
  id: 'hand-axe',
  name: 'Hand Axe',
  tier: 1,
  slot: 'primaryPhysical',
  trait: 'strength',
  range: 'melee',
  damage: { count: 1, sides: 6, modifier: 0 },
  burden: 'oneHanded',
};

const WARDEN = { id: 'lantern-warden', name: 'Lantern Warden', startingEvasion: 10, startingHitPoints: 6 };

describe('writing a project out as a pack', () => {
  it('carries every list a pack reads and nothing else, and reads back entry for entry', () => {
    const project = projectSchema.parse({
      id: 'lantern',
      name: 'Lantern',
      scenes: [sceneSchema.parse(blankScene('room', 4, 4))],
      startScene: 'room',
      ...STARTER_PACK,
      abilities: [...STARTER_ABILITIES],
      conditionDefs: [...STARTER_CONDITIONS],
    });
    const pack = packOf(project);
    expect(pack.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(Object.keys(pack)).not.toContain('scenes');

    const reading = readPack(JSON.parse(JSON.stringify(pack)), 'lantern-pack.json');
    expect(reading.refused).toBeNull();
    expect(reading.issues).toEqual([]);
    for (const list of PACK_LISTS) expect(reading.pack[list]).toEqual(project[list]);
    expect(describePack(reading.pack)).toContain('39 cards');

    // A copy: writing to the file touches nothing in the project it came from.
    pack.cards[0]!.name = 'Renamed';
    expect(project.cards[0]!.name).not.toBe('Renamed');
  });
});

describe('reading a pack', () => {
  it('reads a genuine version-1 project as a pack, rewriting it on the way in', () => {
    // Captured by code that no longer exists, before the rename, and never edited since: see the
    // README beside it. Its abilities and conditions are content written in the old vocabulary.
    const raw = json('tests/fixtures/v1/project.json') as { abilities: { source: { kind: string } }[] };
    const reading = readPack(raw, 'project.json');

    expect(reading.refused).toBeNull();
    expect(reading.issues).toEqual([]);
    expect(reading.pack.abilities).toHaveLength(19);
    expect(reading.pack.conditionDefs).toHaveLength(56);
    // Seven of its abilities sat on something other than a card: two class features, the class's
    // own-resource feature, three subclass features and one a project handed to a character. Read,
    // each sits on a card the version-3 step built from it, granted the way its source said -- and
    // the file's own object was not touched by the reading.
    expect(raw.abilities.filter((a) => !('card' in a.source))).toHaveLength(7);
    const built = new Set(reading.pack.cards.map((card) => card.id));
    expect(reading.pack.abilities.filter((a) => built.has(cardOf(a)))).toHaveLength(7);
    expect(reading.pack.cards.map((card) => card.grant.kind).sort()).toEqual([
      'class', 'class', 'class', 'given', 'subclass', 'subclass', 'subclass',
    ]);
    // A project's scenes and party are not content, and stay behind.
    expect(Object.keys(reading.pack)).not.toContain('scenes');
    expect(() => packDocumentSchema.parse(reading.pack)).not.toThrow();
  });

  it('skips an entry it cannot read, and keeps the rest of its list', () => {
    const reading = readPack({ weapons: [AXE, { ...AXE, id: 'blunt-axe', tier: 0 }] }, 'mine.json');

    expect(reading.refused).toBeNull();
    expect(reading.pack.weapons.map((w) => w.id)).toEqual(['hand-axe']);
    expect(reading.issues).toHaveLength(1);
    expect(reading.issues[0]).toMatchObject({ source: 'mine.json', entry: 'blunt-axe', field: 'weapons.1.tier' });
  });

  it('refuses a pack from a newer build rather than half-reading it', () => {
    const reading = readPack({ formatVersion: 99, weapons: [AXE] });

    expect(reading.refused).toMatch(/newer build/);
    expect(reading.pack.weapons).toEqual([]);
  });

  it('refuses a file that is not a pack at all', () => {
    expect(readPack([AXE]).refused).toMatch(/not a JSON object/);
    expect(readPack({ name: 'a shopping list' }).refused).toMatch(/none of the lists a pack is made of/);

    const wrongShape = readPack({ weapons: 'hand-axe' });
    expect(wrongShape.refused).toMatch(/none of the lists a pack is made of/);
    expect(wrongShape.issues).toMatchObject([{ field: 'weapons', message: 'expected a list' }]);

    const unreadable = readPack({ weapons: [{ id: 'nothing-else' }] });
    expect(unreadable.refused).toBe('none of its 1 entries could be read');
    expect(unreadable.issues).toHaveLength(1);
  });

  it('carries code, and names it in words as the scripts it is', () => {
    const reading = readPack({ formatVersion: 4, code: [{ id: 'lantern-spark', name: 'Spark', source: "ctx.log('A spark.');" }] });

    expect(reading.refused).toBeNull();
    expect(reading.pack.code).toEqual([{ id: 'lantern-spark', name: 'Spark', notes: '', source: "ctx.log('A spark.');" }]);
    expect(describePack(reading.pack)).toBe('1 script');
  });

  it('says what it read in words', () => {
    const reading = readPack({ weapons: [AXE], classes: [WARDEN, { ...WARDEN, id: 'road-warden' }] });

    expect(describePack(reading.pack)).toBe('1 weapon, 2 classes');
  });

  // The catalogue slice 3 exported before it deleted the source. Git-ignored, so it exists only on
  // a machine that ran that export; everywhere else this is skipped, and the report says so.
  const EXPORT = ['packs/srd.json', 'packs/srd-abilities.json'] as const;
  it.skipIf(!EXPORT.every((path) => existsSync(`${repoRoot}${path}`)))(
    'reads the exported catalogue whole, where this machine has it',
    () => {
      const content = readPack(json(EXPORT[0]), EXPORT[0]);
      const mechanics = readPack(json(EXPORT[1]), EXPORT[1]);

      expect([...content.issues, ...mechanics.issues]).toEqual([]);
      expect(describePack(content.pack)).toBe(
        // 189 chosen cards, and the 145 features its classes, subclasses, ancestries and communities
        // printed, each a card granted by what printed it since format version 3.
        '192 weapons, 34 armors, 9 classes, 18 ancestries, 9 communities, 18 subclasses, 334 cards, 129 adversaries',
      );
      // Eight of the cards are built from abilities that sat on no card: three of a class's own
      // resource and five a subclass printed. Imported beside the content file, each duplicates a
      // printed card it built by name -- the two files were exported apart, and are read apart.
      // The other two are what Invisible and Echoing Strike lend, since format version 4: each
      // spell's second half, moved off the spell onto a card of its own. The three scripts are the
      // code three of its cards run, which the engine stopped shipping: they compile as they are.
      expect(describePack(mechanics.pack)).toBe('10 cards, 185 abilities, 54 conditions, 3 scripts');
      expect(compileHooks(mechanics.pack.code).issues).toEqual([]);
    },
  );
});
