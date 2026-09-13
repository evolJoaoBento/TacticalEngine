/**
 * Reading documents older than the code reading them.
 *
 * A saved file is a promise to every copy already on disk. When a persisted name changes, the
 * choice is to break those files or to rewrite them on the way in, and rewriting is the only one
 * that keeps the promise. So this is the door every stored document comes through, before any
 * schema sees it.
 *
 * **It works on raw objects, not parsed ones.** `projectSchema` is an object followed by
 * `superRefine`, and refinements run after parsing — so by the time a schema could migrate
 * something, it has already rejected it for having the wrong shape. Both doors therefore read JSON,
 * migrate, and only then validate.
 *
 * Each step is named for the version it produces and does one rename. A document two versions
 * behind walks through every step in order, which is why they are written as a chain rather than a
 * switch: adding version 4 means appending one function, not editing three.
 *
 * What this deliberately does not do is guess. A document whose `formatVersion` is newer than the
 * code understands is left exactly as it is, so the schema refuses it and the player is told the
 * file is from a newer build — which is true and useful, where a silent downgrade would not be.
 */

/**
 * The version this build writes, owned by the schema that validates it.
 *
 * Declared there rather than here so the dependency runs one way: the schema is the authority on
 * what a document may say, and a migration is a reader of that authority. Re-exported because the
 * doors and the tests want it from whichever side they already import.
 */
export { CURRENT_FORMAT_VERSION } from './schema';
import { CURRENT_FORMAT_VERSION } from './schema';

/** A raw document, before any schema has looked at it. */
type Raw = Record<string, unknown>;

const isObject = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The version a raw document claims, or 1 when it claims none — the oldest files predate the field. */
function versionOf(raw: Raw): number {
  const claimed = raw['formatVersion'];
  return typeof claimed === 'number' && Number.isFinite(claimed) ? claimed : 1;
}

/**
 * Rename a key on an object, in place, keeping its value.
 *
 * Absent keys are left alone rather than written as `undefined`: a document that never had the
 * field should not come out carrying it, because `exactOptionalPropertyTypes` draws exactly that
 * distinction and a schema with an optional field means "absent or a value", not "present and
 * undefined".
 */
function renameKey(target: Raw, from: string, to: string): void {
  if (!(from in target)) return;
  target[to] = target[from];
  delete target[from];
}

/**
 * Version 1 to 2: the two paired resources are renamed.
 *
 * `hope` becomes `good` and `fear` becomes `bad`, everywhere a document carries them as a
 * *field name* rather than as words a player reads.
 *
 * Back-facing names on purpose. What a player reads is **Light** and **Shadow**; what a file
 * stores is `good` and `bad`, which collide with nothing — `light` and `shadow` are already this
 * codebase's words, taken by `spotlight` (the engine's own turn concept) and by the renderer's
 * shadow mapping.
 *
 * In a project the names appear as an ability's `cost`, the four `check` outcome keys, a pool
 * named in a selector or a condition, and a log line's tone. In a save they are the scene's own
 * pool and each entity's.
 */
function toVersion2(raw: Raw): void {
  renameKey(raw, 'hope', 'good');
  renameKey(raw, 'fear', 'bad');

  // The four persisted outcome keys on a `check`. They are keys rather than values, so they are
  // renamed the same way and not by walking a list of strings.
  renameKey(raw, 'onSuccessWithHope', 'onSuccessWithGood');
  renameKey(raw, 'onSuccessWithFear', 'onSuccessWithBad');
  renameKey(raw, 'onFailureWithHope', 'onFailureWithGood');
  renameKey(raw, 'onFailureWithFear', 'onFailureWithBad');

  // And the same words where a document carries them as a *value*: a pool selector, a roll
  // outcome, a log tone, a reroll's `which`.
  // Enumerated from the schemas rather than recalled. An earlier version of this map had eleven
  // entries and missed three that the captured version-1 project actually contains, which is the
  // argument for reading the vocabulary out of `src/engine/` instead of writing it from memory.
  //
  // Not here on purpose: `costsFear`, a legacy field the pack schema dropped for
  // `costsGmResource` and which a test asserts is absent; and `gainHopeFor`, a method on the world
  // interface rather than anything a document says.
  const VALUES: Readonly<Record<string, string>> = {
    hope: 'good',
    fear: 'bad',
    successWithHope: 'successWithGood',
    successWithFear: 'successWithBad',
    failureWithHope: 'failureWithGood',
    failureWithFear: 'failureWithBad',
    gainHope: 'gainGood',
    loseHope: 'loseGood',
    spendHope: 'spendGood',
    gainFear: 'gainBad',
    loseFear: 'loseBad',
    // A `rolled` condition's `is`, and a countdown's `advance` — the latter required on every
    // saved countdown, so a save with one carries this word.
    withHope: 'withGood',
    withFear: 'withBad',
    // An ability's source kind, persisted in `project.abilities[].source.kind`.
    classHope: 'classGood',
  };

  // `hopeDie` is a KEY rather than a value, and the only one of the paired-resource keys that a
  // document carries: `conditionDefSchema` declares it, and the captured version-1 project has one.
  // Every other key the sweep turned up -- hopeGained, fearGained, hopeSpent, hopeDieSides -- is a
  // TypeScript interface field on a roll summary or a defence result, declared in attack.ts,
  // duality.ts, runner.ts and defense.ts. None is a schema, a save's log is `{text, tone}` alone,
  // and so none of them reaches a document. They rename with the code.
  renameKey(raw, 'hopeDie', 'goodDie');
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' && value in VALUES) raw[key] = VALUES[value];
  }
}

/**
 * Walk a raw document and everything inside it, applying one rewrite at every level.
 *
 * Depth-first and total: version 2's names appear at every depth — an ability's cost, an effect's
 * tone, a snapshot entity's pool — and a migration that only looked at the top level would rewrite
 * the version field and nothing else.
 */
function walk(value: unknown, apply: (raw: Raw) => void): void {
  if (Array.isArray(value)) {
    for (const entry of value) walk(entry, apply);
    return;
  }
  if (!isObject(value)) return;
  apply(value);
  for (const entry of Object.values(value)) walk(entry, apply);
}

/**
 * Every step, in the order a document takes them, keyed by the version each one produces.
 *
 * A step is handed the whole document and decides for itself where to look. Version 2's renames were
 * words that meant one thing wherever they appeared, so it walks every depth. A later step need not
 * and often must not: one name can mean two things in two places — a pack's list and a sheet's
 * field — and a step that rewrote every depth would rewrite both.
 */
const STEPS: readonly { to: number; migrate: (doc: Raw) => void }[] = [
  { to: 2, migrate: (doc) => walk(doc, toVersion2) },
];

/**
 * Bring a raw stored document up to the version this build writes.
 *
 * Returns a **new** object; the input is not touched, so a caller that wants to report what the
 * file used to say still can. A document already current comes back unchanged apart from the copy,
 * and one from a newer build comes back untouched so the schema can refuse it honestly.
 */
export function migrateDocument(raw: unknown): unknown {
  if (!isObject(raw)) return raw;
  const copy = structuredClone(raw) as Raw;
  const from = versionOf(copy);
  if (from >= CURRENT_FORMAT_VERSION) return copy;

  for (const step of STEPS) {
    if (from >= step.to) continue;
    step.migrate(copy);
  }
  copy['formatVersion'] = CURRENT_FORMAT_VERSION;
  return copy;
}
