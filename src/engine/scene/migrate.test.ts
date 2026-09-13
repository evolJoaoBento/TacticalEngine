import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrateDocument, CURRENT_FORMAT_VERSION } from './migrate';
import { projectSchema } from './schema';

/**
 * Reading a version-1 document with version-2 code.
 *
 * The fixtures are **real**: a capture tool ran the demo at commit 977840b and wrote what the code
 * wrote at the time, before the rename existed — `tests/fixtures/v1/README.md` records how. That
 * matters more than it looks. A hand-written "old document" is written by the same person as the
 * migration, to match it, and proves only that the two agree; one captured from a build that never
 * heard of version 2 can disagree, which is the only way this test can fail for a real reason.
 *
 * The tool itself is gone. It read the pools by their old names, so the rename it existed to prove
 * is what ended it — afterwards it could only have written version-2 documents into a directory
 * named `v1`.
 *
 * The save fixture was taken after spending a Light and marking Shadow on purpose, so both pools carry
 * values rather than defaults — a migration that quietly did nothing would pass against a pristine
 * room.
 */

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(`${repoRoot}tests/fixtures/v1/${name}.json`, 'utf8'));

/** Every value at every depth, for asking what a whole document still contains. */
function values(node: unknown, into: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const entry of node) values(entry, into);
    return into;
  }
  if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      into.push(key);
      if (typeof value === 'string') into.push(value);
      else values(value, into);
    }
  }
  return into;
}

describe('migrating a stored document', () => {
  it('leaves a document from a newer build alone, so the schema can refuse it', () => {
    const future = { formatVersion: 99, hope: { value: 1, max: 6 } };
    expect(migrateDocument(future)).toEqual(future);
  });

  it('treats a document with no version as the oldest one', () => {
    const ancient = migrateDocument({ id: 'x', cost: { hope: 1 } }) as Record<string, unknown>;
    expect(ancient['formatVersion']).toBe(CURRENT_FORMAT_VERSION);
    expect(ancient['cost']).toEqual({ good: 1 });
  });

  it('does not touch the object it was given', () => {
    const original = { formatVersion: 1, cost: { hope: 2 } };
    migrateDocument(original);
    expect(original).toEqual({ formatVersion: 1, cost: { hope: 2 } });
  });

  it('renames a key at any depth, not only the top', () => {
    const deep = migrateDocument({
      formatVersion: 1,
      scenes: [{ entities: { kara: { hope: { value: 4, max: 6 } } }, fear: { value: 3, max: 12 } }],
    }) as { scenes: { entities: { kara: Record<string, unknown> }; bad: unknown }[] };
    expect(deep.scenes[0]!.entities.kara['good']).toEqual({ value: 4, max: 6 });
    expect(deep.scenes[0]!.entities.kara['hope']).toBeUndefined();
    expect(deep.scenes[0]!.bad).toEqual({ value: 3, max: 12 });
  });

  /**
   * Every token the schemas define, in one list, so an omission fails here rather than surviving
   * into a document the new schema then rejects. The map this drives was written from memory once
   * and missed three of these.
   */
  const RENAMED: readonly [string, string][] = [
    ['hope', 'good'],
    ['fear', 'bad'],
    ['successWithHope', 'successWithGood'],
    ['successWithFear', 'successWithBad'],
    ['failureWithHope', 'failureWithGood'],
    ['failureWithFear', 'failureWithBad'],
    ['gainHope', 'gainGood'],
    ['loseHope', 'loseGood'],
    ['spendHope', 'spendGood'],
    ['gainFear', 'gainBad'],
    ['loseFear', 'loseBad'],
    ['withHope', 'withGood'],
    ['withFear', 'withBad'],
    ['classHope', 'classGood'],
  ];

  it("renames the one paired-resource KEY a document carries, and leaves the in-memory ones", () => {
    // `hopeDie` is declared by `conditionDefSchema`, and the captured version-1 project has one.
    // `hopeGained`, `fearGained`, `hopeSpent` and `hopeDieSides` are interface fields on roll
    // summaries and defence results — never in a document, since a save's log is `{text, tone}`.
    const doc = migrateDocument({
      formatVersion: 1,
      hopeDie: { sides: 20 },
      hopeGained: 2,
      fearGained: 1,
      hopeSpent: 1,
      hopeDieSides: 20,
    }) as Record<string, unknown>;
    expect(doc['goodDie']).toEqual({ sides: 20 });
    expect(doc['hopeDie']).toBeUndefined();
    expect(doc['hopeGained']).toBe(2);
    expect(doc['fearGained']).toBe(1);
    expect(doc['hopeSpent']).toBe(1);
    expect(doc['hopeDieSides']).toBe(20);
  });

  it.each(RENAMED)('renames the value %s to %s', (from, to) => {
    const doc = migrateDocument({ formatVersion: 1, field: from }) as Record<string, unknown>;
    expect(doc['field']).toBe(to);
  });

  it('leaves a dropped legacy field and a method name alone', () => {
    // `costsFear` is a field the pack schema dropped for `costsGmResource`, and a test asserts it
    // is absent from a parsed block; `gainHopeFor` is a method on the world, not a document key.
    const doc = migrateDocument({ formatVersion: 1, costsFear: true, gainHopeFor: 'x' }) as Record<string, unknown>;
    expect(doc['costsFear']).toBe(true);
    expect(doc['gainHopeFor']).toBe('x');
  });

  it("rewrites a saved countdown's advance, which no captured fixture exercises", () => {
    // `runningCountdownSchema` requires `advance`, and `COUNTDOWN_ADVANCES` contains the word — so
    // a save with a live countdown carries it. The fixtures were taken without one, so this case
    // is synthetic and says so rather than borrowing the fixtures' authority.
    const doc = migrateDocument({
      formatVersion: 1,
      scenario: { countdowns: [{ id: 'c', advance: 'withFear', value: 3 }] },
    }) as { scenario: { countdowns: Record<string, unknown>[] } };
    expect(doc.scenario.countdowns[0]!['advance']).toBe('withBad');
  });

  it('renames the words a document carries as values, not only as keys', () => {
    const doc = migrateDocument({
      formatVersion: 1,
      effects: [
        { kind: 'gainHope', amount: 1 },
        { kind: 'log', text: 'a line', tone: 'fear' },
      ],
      reroll: { which: 'hope' },
      outcome: 'successWithFear',
    }) as { effects: Record<string, unknown>[]; reroll: Record<string, unknown>; outcome: string };
    expect(doc.effects[0]!['kind']).toBe('gainGood');
    expect(doc.effects[1]!['tone']).toBe('bad');
    expect(doc.reroll['which']).toBe('good');
    expect(doc.outcome).toBe('successWithBad');
  });

  it('leaves prose alone: only whole values are renamed', () => {
    const doc = migrateDocument({
      formatVersion: 1,
      effects: [{ kind: 'log', text: 'She spends a Light, and the Shadow rises.' }],
    }) as { effects: { text: string }[] };
    // The log line is words a player reads, not a field name or an enum value.
    expect(doc.effects[0]!.text).toBe('She spends a Light, and the Shadow rises.');
  });

  describe('on the captured version-1 project', () => {
    it('carries the old names before migrating, or the fixture proves nothing', () => {
      const before = values(fixture('project'));
      expect(before).toContain('hope');
      expect(before).toContain('onSuccessWithHope');
    });

    it('comes out at the current version with no old name left anywhere', () => {
      const after = migrateDocument(fixture('project')) as Record<string, unknown>;
      expect(after['formatVersion']).toBe(CURRENT_FORMAT_VERSION);

      const seen = values(after);
      for (const gone of ['hope', 'fear', 'onSuccessWithHope', 'onSuccessWithFear', 'onFailureWithHope', 'onFailureWithFear', 'gainHope', 'loseHope', 'spendHope', 'gainFear']) {
        expect(seen, `"${gone}" survived the migration`).not.toContain(gone);
      }
      expect(seen).toContain('good');
    });
  });

  describe('on the captured version-1 save', () => {
    it('carries a marked pool in both places before migrating', () => {
      const save = fixture('save') as { scenes: Record<string, { fear: unknown; entities: Record<string, Record<string, unknown>> }> };
      const room = Object.values(save.scenes)[0]!;
      expect(room.fear).toEqual({ value: 3, max: 12 });
      expect(Object.values(room.entities).some((entity) => entity['hope'] !== undefined)).toBe(true);
    });

    it('rewrites the scene pool and every entity pool', () => {
      const after = migrateDocument(fixture('save')) as {
        formatVersion: number;
        scenes: Record<string, { bad: unknown; fear?: unknown; entities: Record<string, Record<string, unknown>> }>;
      };
      expect(after.formatVersion).toBe(CURRENT_FORMAT_VERSION);

      const room = Object.values(after.scenes)[0]!;
      expect(room.bad).toEqual({ value: 3, max: 12 });
      expect(room.fear).toBeUndefined();

      const withPool = Object.values(room.entities).filter((entity) => entity['good'] !== undefined);
      expect(withPool.length).toBeGreaterThan(0);
      for (const entity of Object.values(room.entities)) expect(entity['hope']).toBeUndefined();
    });
  });
});

/**
 * Version 2 to 3, which is positional where version 2 was total.
 *
 * `domainCards` is two things: a pack's (or a project's) list of card definitions, which becomes
 * `cards`, and a sheet's list of the card ids that character took, which keeps its name. The value
 * `'domainCard'` is also a level-up pick. A step that walked every depth would rewrite all three, so
 * each test here pins one of the things a walk would have broken.
 */
describe('version 2 to 3: a card list is `cards`, and only at the root', () => {
  it("renames the root list and leaves a sheet's held cards and its level-up picks alone", () => {
    const doc = migrateDocument({
      formatVersion: 2,
      domainCards: [{ id: 'spark', name: 'Spark' }],
      party: [{ id: 'kara', domainCards: ['spark'], levels: [{ advancements: [{ kind: 'domainCard', card: 'spark' }] }] }],
    }) as {
      cards?: unknown;
      domainCards?: unknown;
      party: { domainCards?: unknown; levels: { advancements: { kind: string }[] }[] }[];
    };
    expect(doc.cards).toEqual([{ id: 'spark', name: 'Spark' }]);
    expect(doc.domainCards).toBeUndefined();
    expect(doc.party[0]!.domainCards).toEqual(['spark']);
    expect(doc.party[0]!.levels[0]!.advancements[0]!.kind).toBe('domainCard');
  });

  it('does not walk: the same name one level down is somebody else’s and stays', () => {
    const doc = migrateDocument({ formatVersion: 2, nested: { domainCards: ['x'] } }) as Record<string, unknown>;
    expect(doc['nested']).toEqual({ domainCards: ['x'] });
    expect(doc['formatVersion']).toBe(CURRENT_FORMAT_VERSION);
  });

  it('moves the captured project’s list, and every sheet in it keeps its own', () => {
    const before = fixture('project') as { domainCards: unknown[]; party: { domainCards?: string[] }[] };
    // Without held cards on a sheet this would pass against a migration that renamed everything.
    expect(before.party.some((sheet) => (sheet.domainCards ?? []).length > 0)).toBe(true);

    const after = migrateDocument(before) as { cards?: unknown; domainCards?: unknown; party: { domainCards?: string[] }[] };
    expect(after.domainCards).toBeUndefined();
    // The root list's own entries come first and unchanged; the cards built from abilities follow.
    expect((after.cards as unknown[]).slice(0, before.domainCards.length)).toEqual(before.domainCards);
    expect(after.party.map((sheet) => sheet.domainCards)).toEqual(before.party.map((sheet) => sheet.domainCards));
  });

  it('puts a class feature and its ability on one card, granted by the class', () => {
    const doc = migrateDocument({
      formatVersion: 2,
      classes: [
        {
          id: 'warden',
          name: 'Warden',
          features: [{ name: 'Drilled', text: 'Printed words.' }],
          signatureFeature: { name: 'Stand Fast', text: 'Signature words.' },
        },
      ],
      abilities: [
        { id: 'warden-drilled', name: 'Drilled', source: { kind: 'classFeature', classId: 'warden' }, text: '' },
        { id: 'warden-stand', name: 'Stand', source: { kind: 'classGood', classId: 'warden' }, text: 'Its own words.' },
        { id: 'swing', name: 'Swing', source: { kind: 'domainCard', card: 'swing' } },
        { id: 'claws', name: 'Claws', source: { kind: 'adversary', adversaries: ['husk'] } },
      ],
    }) as { classes: Record<string, unknown>[]; abilities: { source: unknown }[]; cards: unknown[] };

    expect(doc.classes[0]).toEqual({ id: 'warden', name: 'Warden' });
    expect(doc.abilities.map((a) => a.source)).toEqual([
      { card: 'warden-drilled' },
      { card: 'warden-stand' },
      { card: 'swing' },
      // A stat block's feature waits for the GM's side to become cards.
      { kind: 'adversary', adversaries: ['husk'] },
    ]);
    // The printed Drilled filled the empty text of its ability's card; the signature joined the
    // class's own-resource card, which kept its own words. Two cards, not four.
    expect(doc.cards).toEqual([
      { id: 'warden-drilled', name: 'Drilled', text: 'Printed words.', grant: { kind: 'class', classId: 'warden' } },
      { id: 'warden-stand', name: 'Stand', text: 'Its own words.', grant: { kind: 'class', classId: 'warden' } },
    ]);
  });

  it('grants what a subclass, an ancestry and a project gave, the way each gave it', () => {
    const doc = migrateDocument({
      formatVersion: 2,
      subclasses: [{ id: 'scribe', name: 'Scribe', classId: 'adept', mastery: [{ name: 'Whole Library', text: 'Everything.' }] }],
      ancestries: [{ id: 'kin', name: 'Kin', features: [{ name: 'Steady', text: 'Hard to move.' }] }],
      abilities: [{ id: 'rally', name: 'Rally', source: { kind: 'granted', characters: ['kara'] } }],
    }) as { cards: unknown[]; subclasses: Record<string, unknown>[]; ancestries: Record<string, unknown>[] };

    expect(doc.subclasses[0]).toEqual({ id: 'scribe', name: 'Scribe', classId: 'adept' });
    expect(doc.ancestries[0]).toEqual({ id: 'kin', name: 'Kin' });
    expect(doc.cards).toEqual([
      { id: 'rally', name: 'Rally', text: '', grant: { kind: 'given', characters: ['kara'] } },
      { id: 'scribe-whole-library', name: 'Whole Library', text: 'Everything.', grant: { kind: 'subclass', subclassId: 'scribe', stage: 'mastery' } },
      { id: 'kin-steady', name: 'Steady', text: 'Hard to move.', grant: { kind: 'ancestry', ancestryId: 'kin' } },
    ]);
  });

  it('never gives a built card an id a card already has', () => {
    const doc = migrateDocument({
      formatVersion: 2,
      domainCards: [{ id: 'rally', name: 'Rally' }],
      abilities: [{ id: 'rally', name: 'Rally', source: { kind: 'granted', characters: [] } }],
    }) as { cards: { id: string }[]; abilities: { source: unknown }[] };
    expect(doc.cards.map((card) => card.id)).toEqual(['rally', 'rally-2']);
    expect(doc.abilities[0]!.source).toEqual({ card: 'rally-2' });
  });

  it('passes the captured save through with every sheet’s held cards where they were', () => {
    const before = fixture('save') as { sheets: { domainCards?: string[] }[] };
    expect(before.sheets.some((sheet) => (sheet.domainCards ?? []).length > 0)).toBe(true);

    const after = migrateDocument(before) as { cards?: unknown; sheets: { domainCards?: string[] }[] };
    expect(after.cards).toBeUndefined();
    expect(after.sheets.map((sheet) => sheet.domainCards)).toEqual(before.sheets.map((sheet) => sheet.domainCards));
  });
});

/**
 * The property the rest of this file does not check: that what comes out the other side is a
 * document the engine will actually *load*.
 *
 * Every test above compares fields — this name is gone, that one arrived. All of them can pass
 * while `projectSchema` still refuses the result, because renaming fourteen tokens correctly says
 * nothing about whether the document that remains satisfies a required field, a discriminated
 * union's literal, or `projectSchema`'s own `superRefine`. Validation is the condition the
 * production path actually depends on: `main.ts` does
 * `projectSchema.safeParse(migrateDocument(...))`, and a project that fails it is reported to the
 * player as damaged.
 */
describe('a migrated document satisfies the schema that will load it', () => {
  /** Zod issues as readable lines, so a failure names the field instead of printing `false`. */
  const refusals = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }): string[] =>
    result.success ? [] : (result.error?.issues ?? []).map((issue) => `${issue.path.join('.')}: ${issue.message}`);

  it('accepts the captured version-1 project once migrated', () => {
    expect(refusals(projectSchema.safeParse(migrateDocument(fixture('project'))))).toEqual([]);
  });

  it('refuses the same project unmigrated, so the migration is load-bearing', () => {
    // Without this the test above proves nothing: a schema that accepted the old names too would
    // pass it while the migration did nothing at all.
    expect(refusals(projectSchema.safeParse(fixture('project')))).not.toEqual([]);
  });
});
