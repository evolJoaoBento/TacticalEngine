# Content Packs, Slice 1: the pack architecture

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the engine's character content a described, validated, project-carryable **pack**, without deleting anything or changing a single rule.

**Architecture:** The engine already reads character content through a parameter (`sheet.ts` takes `content: SrdCharacterContent`) and already has generic importers taking `raw: readonly unknown[]`. This slice gives that shape a name (`ContentPack`), a home (`content/pack/`), a zod schema, and a place in the project document. The eight vendored JSON imports in `demo-scene.ts` stay exactly where they are: this slice deletes nothing and ends green.

**Tech Stack:** TypeScript 7 strict (`exactOptionalPropertyTypes` is on), zod 4, Vitest 5, Playwright 1.62.

**Spec:** `docs/superpowers/specs/2026-09-12-generic-engine-content-packs-design.md`

## Global Constraints

- `npx tsc --noEmit` is the only static check. No lint, no formatter — match surrounding style by reading it. One statement per line.
- The repo is LF (`.gitattributes` sets `* text=auto eol=lf`). Python patch scripts open with `newline=''`.
- The repository path contains a space. Quote it.
- Never `git checkout` a file with uncommitted work; copy it aside and back.
- `src/main.ts` declares `window.__polyheart`; `tests/e2e/demo.spec.ts` hand-mirrors that type. Change both together.
- Every new module is tested. Show each new test red before writing the code that satisfies it.
- Before claiming done: `npx tsc --noEmit`, `npx vitest run`, `npx playwright test`.
- **This slice deletes nothing.** No file under `tools/srd-sources/` is removed, no import is cut, no term is renamed. Those are slices 2–4.
- Baseline at the time of writing: tsc clean, **1796 unit tests across 89 files**, **103 Playwright tests**.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/engine/content/pack/schema.ts` | **New.** Zod schemas for the seven content kinds, and `contentPackSchema`. The document contract. |
| `src/engine/content/pack/schema.test.ts` | **New.** What each schema accepts and refuses. |
| `src/engine/content/pack/import.ts` | **Moved** from `content/srd/daggersearch.ts`. The readers that turn a source's raw shapes into typed defs. Bodies unchanged. |
| `src/engine/content/pack/import.test.ts` | **Moved** from `content/srd/daggersearch.test.ts` if one exists; otherwise untouched. |
| `src/engine/scene/schema.ts` | Gains the seven content fields on `projectSchema`, each defaulted. |
| `src/engine/content/types.ts` | Unchanged — `ImportResult`, `ContentIssue`, `toContentId` are already source-neutral. Only a stale comment is repointed. |
| 10 consumers of `SrdCharacterContent` | Renamed to `ContentPack`, import path updated. |

`content/srd/abilities.ts`, `adversary-abilities.ts`, `seansbox-adversaries.ts` and `hooks.ts` **stay where they are**. They are deleted in slice 3, and moving them first would be churn.

---

## Task 1: The pack schema

**Files:**
- Create: `src/engine/content/pack/schema.ts`
- Create: `src/engine/content/pack/schema.test.ts`

**Interfaces:**
- Consumes: `contentIdSchema` and `traitSchema` from `src/engine/scene/primitives.ts`; `RANGE_BANDS` from `src/engine/rules/range.ts`.
- Produces: `featureSchema`, `rangeBandSchema`, `diceExpressionSchema`, `parsedDamageSchema`, `weaponDefSchema`, `armorDefSchema`, `classDefSchema`, `ancestryDefSchema`, `communityDefSchema`, `subclassDefSchema`, `domainCardDefSchema`, `contentPackSchema`, and `type ContentPackDoc = z.infer<typeof contentPackSchema>`.

Two decisions are made here deliberately, and both save work later:

1. `ClassDef.hopeFeature` becomes **`signatureFeature`** in the schema. The field is about to become persisted project data, and slice 4 renames Hope to Light; naming it neutrally at birth means there is nothing to migrate. The importer maps the old key to the new field in Task 2.
2. `DamageThresholds` is `{ major, severe }`, and `NO_THRESHOLDS` uses `Infinity`. `JSON.stringify(Infinity)` is `null`, so an infinite threshold cannot survive a saved project. The schema requires **finite non-negative integers**; a pack that wants "no threshold" writes a large number, not infinity.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  armorDefSchema,
  classDefSchema,
  contentPackSchema,
  domainCardDefSchema,
  weaponDefSchema,
} from './schema';

describe('weapons', () => {
  it('accepts a weapon and keeps its damage expression', () => {
    const parsed = weaponDefSchema.parse({
      id: 'broadsword',
      name: 'Broadsword',
      tier: 1,
      slot: 'primaryPhysical',
      trait: 'agility',
      range: 'melee',
      damage: { count: 1, sides: 8, modifier: 3, types: ['physical'] },
      burden: 'oneHanded',
    });
    expect(parsed.damage.sides).toBe(8);
    expect(parsed.features).toEqual([]);
  });

  it('refuses a range band it does not know', () => {
    const bad = weaponDefSchema.safeParse({
      id: 'x', name: 'X', tier: 1, slot: 'secondary', trait: 'agility',
      range: 'adjacent', damage: { count: 1, sides: 6, modifier: 0 }, burden: 'oneHanded',
    });
    expect(bad.success).toBe(false);
  });
});

describe('armors', () => {
  it('refuses a threshold that cannot survive a save', () => {
    // JSON.stringify(Infinity) is null: an infinite threshold is not storable.
    const bad = armorDefSchema.safeParse({
      id: 'chain', name: 'Chainmail', tier: 1, baseScore: 4,
      baseThresholds: { major: Infinity, severe: Infinity },
    });
    expect(bad.success).toBe(false);
  });
});

describe('classes', () => {
  it('names the signature feature neutrally, not after a resource', () => {
    const parsed = classDefSchema.parse({
      id: 'sentinel',
      name: 'Sentinel',
      domains: ['bulwark'],
      startingEvasion: 9,
      startingHitPoints: 7,
      signatureFeature: { name: 'Hold the Line', text: 'Stand your ground.' },
    });
    expect(parsed.signatureFeature?.name).toBe('Hold the Line');
    expect('hopeFeature' in parsed).toBe(false);
  });
});

describe('domain cards', () => {
  it('takes a card and defaults its features', () => {
    const parsed = domainCardDefSchema.parse({
      id: 'power-slash', name: 'Power Slash', domain: 'blade',
      type: 'ability', level: 1, recallCost: 1, text: 'Strike hard.',
    });
    expect(parsed.features).toEqual([]);
  });
});

describe('the pack', () => {
  it('is empty by default, so a project that declares none still parses', () => {
    const parsed = contentPackSchema.parse({});
    expect(parsed.classes).toEqual([]);
    expect(parsed.weapons).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/engine/content/pack/schema.test.ts`
Expected: FAIL — `Cannot find module './schema'`.

- [ ] **Step 3: Write the schema**

```ts
/**
 * What a content pack is, as a document.
 *
 * The engine reads character content through a parameter rather than a fixed
 * catalogue, so a pack is simply data: classes, ancestries, cards and the
 * equipment they use. These schemas are the contract a pack is validated
 * against, whether it ships with the engine, rides inside a project, or is
 * imported from somewhere else entirely.
 */

import { z } from 'zod';
import { contentIdSchema, traitSchema } from '../../scene/primitives';
import { RANGE_BANDS } from '../../rules/range';

/** A named piece of rules text on a class, ancestry, card or weapon. */
export const featureSchema = z.object({
  name: z.string(),
  text: z.string(),
});

export const rangeBandSchema = z.enum(RANGE_BANDS);

export const diceExpressionSchema = z.object({
  /** Zero is legal: a flat "+3" expression. */
  count: z.number().int().min(0),
  /** Zero when `count` is zero. */
  sides: z.number().int().min(0),
  modifier: z.number().int(),
});

export const damageTypeSchema = z.enum(['physical', 'magic']);

export const parsedDamageSchema = diceExpressionSchema.extend({
  types: z.array(damageTypeSchema).nonempty().optional(),
});

/**
 * Finite and non-negative, deliberately. `NO_THRESHOLDS` uses `Infinity`, which
 * `JSON.stringify` writes as `null` — a pack that wants "nothing reaches this
 * band" writes a large number rather than an unstorable one.
 */
export const damageThresholdsSchema = z.object({
  major: z.number().int().min(0),
  severe: z.number().int().min(0),
});

export const weaponDefSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  tier: z.number().int().min(1),
  slot: z.enum(['primaryPhysical', 'primaryMagic', 'secondary']),
  trait: traitSchema,
  range: rangeBandSchema,
  damage: parsedDamageSchema,
  burden: z.enum(['oneHanded', 'twoHanded']),
  features: z.array(featureSchema).default([]),
});

export const armorDefSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  tier: z.number().int().min(1),
  baseThresholds: damageThresholdsSchema,
  baseScore: z.number().int().min(0),
  features: z.array(featureSchema).default([]),
});

export const classDefSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  domains: z.array(z.string().min(1)).default([]),
  startingEvasion: z.number().int().min(0),
  startingHitPoints: z.number().int().min(1),
  /**
   * The feature a class grants for its own resource. Named for what it is
   * rather than for the resource, so renaming the resource never touches
   * saved packs.
   */
  signatureFeature: featureSchema.optional(),
  features: z.array(featureSchema).default([]),
});

export const ancestryDefSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  features: z.array(featureSchema).default([]),
});

export const communityDefSchema = ancestryDefSchema;

export const subclassDefSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  classId: contentIdSchema,
  domains: z.array(z.string().min(1)).default([]),
  spellcastTrait: traitSchema.optional(),
  foundation: z.array(featureSchema).default([]),
  specialization: z.array(featureSchema).default([]),
  mastery: z.array(featureSchema).default([]),
});

export const domainCardDefSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  domain: z.string().min(1),
  type: z.enum(['ability', 'spell', 'grimoire']),
  level: z.number().int().min(1),
  recallCost: z.number().int().min(0),
  text: z.string().default(''),
  features: z.array(featureSchema).default([]),
});

/**
 * Everything a character can be built from. Every list is defaulted, so a pack
 * may carry only what it has and a project that declares none still parses.
 */
export const contentPackSchema = z.object({
  weapons: z.array(weaponDefSchema).default([]),
  armors: z.array(armorDefSchema).default([]),
  classes: z.array(classDefSchema).default([]),
  ancestries: z.array(ancestryDefSchema).default([]),
  communities: z.array(communityDefSchema).default([]),
  subclasses: z.array(subclassDefSchema).default([]),
  domainCards: z.array(domainCardDefSchema).default([]),
});

export type ContentPackDoc = z.infer<typeof contentPackSchema>;
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/engine/content/pack/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/content/pack/schema.ts src/engine/content/pack/schema.test.ts
git commit -m "Describe a content pack as a document"
```

---

## Task 2: Rename the shape and move the importers

**Files:**
- Move: `src/engine/content/srd/daggersearch.ts` → `src/engine/content/pack/import.ts`
- Modify: the 10 files naming `SrdCharacterContent`

**Interfaces:**
- Consumes: Task 1's schemas (for `signatureFeature`).
- Produces: `export interface ContentPack { weapons, armors, classes, ancestries, communities, subclasses, domainCards }` — seven `ReadonlyMap`s, unchanged in shape. `importCharacterContent` keeps its signature and is re-exported as `importContentPack`.

`SrdCharacterContent` is renamed, not redesigned. The maps, the importers and their bodies stay as they are; only the name, the file's home and one field change.

The ten files naming the type:

```
src/editor/ui/EditorShell.tsx      src/engine/character/progression.test.ts
src/editor/ui/ItemPanel.tsx        src/engine/character/progression.ts
src/editor/ui/PartyPanel.tsx       src/engine/character/sheet.test.ts
src/editor/validate.ts             src/engine/character/sheet.ts
src/game/ui/LevelUpPanel.tsx       src/engine/content/srd/daggersearch.ts (the file itself)
```

- [ ] **Step 1: Move the file with git, so history follows it**

```bash
git mv src/engine/content/srd/daggersearch.ts src/engine/content/pack/import.ts
```

- [ ] **Step 2: Rename the type and the entry point inside it**

In `src/engine/content/pack/import.ts`: `SrdCharacterContent` → `ContentPack`, `SrdFeature` → `PackFeature`, and `importCharacterContent` → `importContentPack`. Fix the relative import depth — the file moved sideways, not deeper, so `'../../rules/range'` and `'../types'` are unchanged, but re-check each one.

In `ClassDef`, rename `hopeFeature` to `signatureFeature`, and in `importClasses` map the source's key onto it:

```ts
// The source calls this after its own resource; the engine does not.
signatureFeature: feature(entry['hopeFeature']) ?? undefined,
```

- [ ] **Step 3: Let the compiler find every consumer**

Run: `npx tsc --noEmit`
Expected: errors naming each of the ten files. Fix them by renaming the type and repointing the import to `@content/pack/import`. Re-run until clean.

- [ ] **Step 4: Run the suites**

Run: `npx vitest run`
Expected: 1796 passing. A failure here means the rename changed behaviour, which it must not.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "A character's content is a pack, not a source"
```

---

## Task 3: A project carries its pack

**Files:**
- Modify: `src/engine/scene/schema.ts` (the `projectSchema` object, after `adversaryModels`)
- Modify: `src/engine/scene/schema.test.ts`

**Interfaces:**
- Consumes: Task 1's `contentPackSchema` member schemas.
- Produces: `projectSchema` with seven new defaulted arrays.

The seven fields are added **flat**, matching how `abilities`, `items`, `conditionDefs` and `quests` already sit, rather than nested under a `pack` key. Every one is `.default([])`, so a project written before this still parses — the same promise `assets` and `adversaryModels` already make.

- [ ] **Step 1: Write the failing test**

```ts
it('defaults the content lists, so a project written before packs still parses', () => {
  const parsed = projectSchema.parse(project());
  expect(parsed.classes).toEqual([]);
  expect(parsed.ancestries).toEqual([]);
  expect(parsed.domainCards).toEqual([]);
  expect(parsed.weapons).toEqual([]);
});

it('carries a class a project declares', () => {
  const parsed = projectSchema.parse(
    project({
      classes: [
        {
          id: 'sentinel', name: 'Sentinel', domains: ['bulwark'],
          startingEvasion: 9, startingHitPoints: 7,
        },
      ],
    }),
  );
  expect(parsed.classes[0]!.name).toBe('Sentinel');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/engine/scene/schema.test.ts`
Expected: FAIL — `expected undefined to deeply equal []`.

- [ ] **Step 3: Add the fields**

In `src/engine/scene/schema.ts`, import the member schemas from `../content/pack/schema`, and after `adversaryModels`:

```ts
    /**
     * The character content this project is played with. Defaulted like every
     * other list here, so a project written before content became data is
     * still a project. An empty list means "use whatever pack the app loaded".
     */
    classes: z.array(classDefSchema).default([]),
    ancestries: z.array(ancestryDefSchema).default([]),
    communities: z.array(communityDefSchema).default([]),
    subclasses: z.array(subclassDefSchema).default([]),
    domainCards: z.array(domainCardDefSchema).default([]),
    weapons: z.array(weaponDefSchema).default([]),
    armors: z.array(armorDefSchema).default([]),
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/engine/scene/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Find what asserted on a whole parsed project**

Adding defaulted fields changes every exact-object assertion over a parsed project or a project fragment. Three places in this repo already assert exactly that way about assets (`assets.test.ts`, `demo.spec.ts`).

Run: `npx vitest run` and `npx playwright test`
Expected: any failure is a `toEqual` over a whole document. Widen it to assert the fields it means, rather than re-listing the new ones — an exact-object assertion over a growing document is a test that breaks every time the format grows.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "A project carries the content it is played with"
```

---

## Task 4: Leave the map true

**Files:**
- Modify: `src/engine/scene/schema.ts` (the comment at the `adversary` field)
- Modify: `src/engine/content/types.ts` (the header comment)
- Modify: `docs/DEVELOPING.md`, `docs/BACKLOG.md` (re-pin)

Both files point at `content/srd/` in prose. Neither is an import; both are now wrong about where the importers live.

- [ ] **Step 1: Repoint the two comments**

`scene/schema.ts`: "see `content/srd/seansbox-adversaries.ts`" → name the adversary importer's new home once slice 3 moves it, or state the id's meaning without naming a file.
`content/types.ts`: "Importers under `content/srd/`" → "Importers under `content/pack/`".

- [ ] **Step 2: Document the pack in DEVELOPING**

A short section: what a pack is, the seven lists, that a project may carry its own, and that `contentPackSchema` is the contract. Say plainly that the engine ships no catalogue of its own yet — that arrives in slice 2.

- [ ] **Step 3: Re-pin the backlog header**

Run `npx tsc --noEmit`, `npx vitest run`, `npx playwright test`; record the commit and the three numbers in `docs/BACKLOG.md`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Say where content lives now"
```

---

## Done means

- `npx tsc --noEmit` clean.
- `npx vitest run` green, with the new schema tests included.
- `npx playwright test` green — this slice changes no behaviour, so a failure is a regression, not an expectation.
- A project written before this slice parses unchanged.
- Nothing deleted: `tools/srd-sources/` is untouched, the eight imports in `demo-scene.ts` still resolve, and no term has been renamed.
