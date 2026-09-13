import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrateDocument, CURRENT_FORMAT_VERSION } from './migrate';

/**
 * Reading a version-1 document with version-2 code.
 *
 * The fixtures are **real**: `tools/capture-v1-fixtures.ts` ran the demo and wrote what the code
 * wrote at the time, before the rename existed. That matters more than it looks. A hand-written
 * "old document" is written by the same person as the migration, to match it, and proves only that
 * the two agree; one captured from a build that never heard of version 2 can disagree, which is the
 * only way this test can fail for a real reason.
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
