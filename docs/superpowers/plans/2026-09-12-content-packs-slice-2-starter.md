# Content Packs, Slice 2: the starter pack

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an original high-fantasy content pack the engine runs on, and stand the demo up on it — so that when slice 3 deletes the vendored sources, nothing is left leaning on them.

**Architecture:** Slice 1 made character content a described, project-carryable pack. It covered seven kinds; **adversaries were left outside it**, so this slice closes that gap first, then authors the content, then switches the demo over. Both catalogues exist at once throughout: the vendored one is still there as a fallback until slice 3 removes it.

**Tech Stack:** TypeScript 7 strict (`exactOptionalPropertyTypes` on), zod 4, Vitest 5, Playwright 1.62.

**Spec:** `docs/superpowers/specs/2026-09-12-generic-engine-content-packs-design.md`

## Global Constraints

- `npx tsc --noEmit` is the only static check. One statement per line; match surrounding style.
- LF endings; Python patch scripts open with `newline=''`. The repo path contains a space.
- Never `git checkout` a file holding uncommitted work — copy it aside and back.
- `src/main.ts` declares `window.__engine`; `tests/e2e/demo.spec.ts` mirrors that type. Change both together.
- Every new module is tested, and each new test is shown red before the code that satisfies it.
- Before claiming done: `npx tsc --noEmit`, `npx vitest run`, `npx playwright test`.
- **This slice still deletes nothing.** `tools/srd-sources/` stays, and the SRD catalogues stay importable. Slice 3 removes them.
- **All authored text is original.** No name, phrase or rules sentence is taken from any SRD. Plain high fantasy, in the register of *Power Slash*, *Arcane Ward*, *Healing Word*.
- Baseline: tsc clean, **1806 unit tests across 90 files**, **103 Playwright**, at `957c137`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/engine/content/pack/schema.ts` | Gains `experienceSchema`, `adversaryFeatureSchema`, `adversaryDefSchema`; `contentPackSchema` gains `adversaries`. |
| `src/engine/character/sheet-schema.ts` | Drops its private `experienceSchema` and imports the canonical one. |
| `src/engine/scene/schema.ts` | `projectSchema` gains `adversaries`. |
| `src/engine/content/pack/starter.ts` | **New.** The original pack: classes, subclasses, ancestries, communities, weapons, armors, cards, adversaries. Typed objects, so `tsc` checks them. |
| `src/engine/content/pack/starter-abilities.ts` | **New.** The cards' scripts as `AbilityDef[]`. |
| `src/engine/content/pack/starter.test.ts` | **New.** That the pack parses, ids are unique, and every sheet reference resolves. |
| `src/game/demo-scene.ts` | `SRD_CHARACTERS` → the starter pack; `SRD_ADVERSARIES` → its adversaries; `PARTY_SHEETS` and `DEMO_MODELS` re-pointed. |
| 15 files naming SRD ids | Re-pointed to the new ids. |

---

## Task 1: Adversaries join the pack

Slice 1's pack is character content only. An adversary is content in exactly the same sense, and until it is in the pack a project cannot carry one.

**Files:** modify `content/pack/schema.ts`, `character/sheet-schema.ts`, `scene/schema.ts`; test in `content/pack/schema.test.ts`.

**Interfaces:**
- Produces: `experienceSchema`, `adversaryFeatureSchema`, `adversaryDefSchema`; `contentPackSchema.adversaries`; `projectSchema.adversaries`.

Two decisions, both for the same reason as slice 1's `signatureFeature`:

1. `AdversaryFeature.costsFear` becomes **`costsGmResource`**. It is about to become persisted pack data and slice 4 renames the resource; a field named for what it *does* never needs migrating. The importer keeps reading the source's key.
2. `experienceSchema` is defined here and **imported** by `sheet-schema.ts`, which currently keeps a private copy. One shape, one definition.

- [ ] **Step 1: Write the failing test**

```ts
describe('adversaries', () => {
  it('accepts a stat block and defaults its lists', () => {
    const parsed = adversaryDefSchema.parse({
      id: 'fen-lurker',
      name: 'Fen Lurker',
      tier: 1,
      role: 'skulk',
      description: 'A long-limbed thing that waits under the water.',
      motivesAndTactics: 'Drag away the straggler, drown what it takes.',
      difficulty: 11,
      thresholds: { major: 6, severe: 12 },
      hitPoints: 4,
      stress: 3,
      attackName: 'Grasping Arms',
      attackModifier: { count: 0, sides: 0, modifier: 2 },
      attackRange: 'melee',
      attackDamage: { count: 1, sides: 6, modifier: 1, types: ['physical'] },
    });
    expect(parsed.features).toEqual([]);
    expect(parsed.experiences).toEqual([]);
  });

  it('names a feature for what it spends, not for the resource', () => {
    const parsed = adversaryFeatureSchema.parse({
      name: 'Undertow', kind: 'action', text: 'Pull a target into the water.', costsGmResource: true,
    });
    expect(parsed.costsGmResource).toBe(true);
    expect('costsFear' in parsed).toBe(false);
  });

  it('refuses a role it does not know', () => {
    const bad = adversaryDefSchema.safeParse({
      id: 'fen-lurker',
      name: 'Fen Lurker',
      tier: 1,
      role: 'boss',
      difficulty: 11,
      thresholds: { major: 6, severe: 12 },
      hitPoints: 4,
      stress: 3,
      attackName: 'Grasping Arms',
      attackModifier: { count: 0, sides: 0, modifier: 2 },
      attackRange: 'melee',
      attackDamage: { count: 1, sides: 6, modifier: 1 },
    });
    expect(bad.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, watch it fail** — `npx vitest run src/engine/content/pack/schema.test.ts`. Expected: `adversaryDefSchema` is not exported.

- [ ] **Step 3: Add the schemas**

```ts
/** An Experience and its modifier: "Tremor Sense +2". */
export const experienceSchema = z.object({
  name: z.string().min(1),
  modifier: z.number().int(),
});

export const adversaryRoleSchema = z.enum([
  'bruiser', 'horde', 'leader', 'minion', 'ranged',
  'skulk', 'social', 'solo', 'standard', 'support',
]);

export const adversaryFeatureSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['passive', 'action', 'reaction']),
  /** The parenthetical in "Relentless (3)", verbatim; each feature reads it its own way. */
  parameter: z.string().optional(),
  countdown: z.string().optional(),
  longTermCountdown: z.boolean().optional(),
  text: z.string().default(''),
  /**
   * Whether using it spends the GM's currency. Named for what it does rather
   * than for the resource, so renaming that resource never reaches a stored pack.
   */
  costsGmResource: z.boolean().default(false),
});

export const adversaryDefSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  role: adversaryRoleSchema,
  hordeUnitsPerHp: z.number().int().min(1).optional(),
  description: z.string().default(''),
  motivesAndTactics: z.string().default(''),
  difficulty: z.number().int().min(1),
  thresholds: damageThresholdsSchema,
  hitPoints: z.number().int().min(1),
  stress: z.number().int().min(0),
  attackName: z.string().min(1),
  attackModifier: diceExpressionSchema,
  attackRange: rangeBandSchema,
  attackDamage: parsedDamageSchema,
  experiences: z.array(experienceSchema).default([]),
  features: z.array(adversaryFeatureSchema).default([]),
});
```

Add `adversaries: z.array(adversaryDefSchema).default([])` to `contentPackSchema`, and the same field to `projectSchema` beside the seven from slice 1.

- [ ] **Step 4: Point `sheet-schema.ts` at the canonical Experience**

Delete its private `const experienceSchema = …` and import it from `../content/pack/schema`. `tsc` proves nothing else changed.

- [ ] **Step 5: Rename the field on the interface and its importer**

`content/types.ts`: `costsFear` → `costsGmResource`. `content/srd/seansbox-adversaries.ts` keeps reading the source's own key and assigns the new field. Let `tsc` find the consumers.

- [ ] **Step 6: Green, then commit**

`npx vitest run`, `npx tsc --noEmit`. Expect the legacy-import literal to need `adversaries: []`, as it did for the other seven.

```bash
git commit -m "An adversary is pack content too"
```

---

## Task 2: Author the pack

**Files:** create `content/pack/starter.ts`, `content/pack/starter-abilities.ts`, `content/pack/starter.test.ts`.

Everything here is invented for this engine. Names are plain high fantasy so that they read as examples rather than as a setting.

**Three classes.** Domains are this pack's own: `bulwark`, `shadow-step`, `ember`.

| id | name | domains | evasion | HP | signature feature |
|---|---|---|---|---|---|
| `sentinel` | Sentinel | bulwark | 9 | 7 | **Hold the Line** — when an ally within Melee is attacked, you may take the blow instead. |
| `cutpurse` | Cutpurse | shadow-step | 12 | 5 | **Slip the Knot** — once per rest, escape a grapple, bind or snare without a roll. |
| `emberwright` | Emberwright | ember | 10 | 5 | **Kindle** — your next spell this turn deals +2 damage. |

**Three subclasses**, one per class, each with one foundation feature, one specialization and one mastery:

| id | class | foundation |
|---|---|---|
| `shieldbearer` | `sentinel` | **Bulwark Stance** — allies behind you count as having cover. |
| `lampsnuffer` | `cutpurse` | **Douse** — put out a light within Close range as a free action. |
| `flamecaller` | `emberwright` | **Emberhand** — your Ember spells ignore one point of resistance. |

**Three ancestries** and **two communities**, generic tropes, one feature each: `human`, `stoneborn` (dwarf-like), `sylvan` (elf-like); communities `wayfarer`, `guildsworn`.

**Three weapons, two armors.**

| id | name | tier | slot | trait | range | damage | burden |
|---|---|---|---|---|---|---|---|
| `longsword` | Longsword | 1 | primaryPhysical | strength | melee | 1d8+1 physical | oneHanded |
| `hunting-bow` | Hunting Bow | 1 | primaryPhysical | finesse | far | 1d6+1 physical | twoHanded |
| `ember-staff` | Ember Staff | 1 | primaryMagic | knowledge | close | 1d8 magic | twoHanded |

| id | name | tier | thresholds | score |
|---|---|---|---|---|
| `ringmail` | Ringmail | 1 | major 7 / severe 15 | 4 |
| `padded-coat` | Padded Coat | 1 | major 5 / severe 11 | 3 |

**Fifteen cards**, five per domain, levels 1–2, each with an `AbilityDef` in `starter-abilities.ts`:

- *bulwark* — `power-slash`, `shield-wall`, `iron-stance`, `rallying-cry`, `unbroken`
- *shadow-step* — `quick-hands`, `smoke-step`, `backstab`, `vanish`, `cut-purse-strings`
- *ember* — `arcane-ward`, `healing-word`, `emberbolt`, `cinder-burst`, `warding-flame`

Each card's `source` is `{ kind: 'domainCard', card: '<id>' }`. Scripts use the existing effect vocabulary only; a card the vocabulary cannot express ships with text and no script, exactly as the engine already allows.

**Ten adversaries**, tiers 1–2, covering the roles the demo needs:

| id | name | tier | role |
|---|---|---|---|
| `fen-lurker` | Fen Lurker | 1 | skulk |
| `bandit-cutter` | Bandit Cutter | 1 | standard |
| `bandit-archer` | Bandit Archer | 1 | ranged |
| `rot-hound` | Rot Hound | 1 | horde |
| `grave-moth` | Grave Moth | 1 | minion |
| `stone-golem` | Stone Golem | 2 | bruiser |
| `briar-wraith` | Briar Wraith | 2 | skulk |
| `bandit-captain` | Bandit Captain | 2 | leader |
| `hollow-knight` | Hollow Knight | 2 | solo |
| `wandering-hedge-priest` | Wandering Hedge Priest | 1 | social |

`hollow-knight` is the demo's stand-in adversary, replacing `acid-burrower`.

- [ ] **Step 1:** Write `starter.test.ts` first: the pack parses through `contentPackSchema`, every id is unique, every id a `PARTY_SHEETS` entry names resolves, and every `AbilityDef.source.card` names a card in the pack.
- [ ] **Step 2:** Run it — fails, `starter.ts` does not exist.
- [ ] **Step 3:** Author `starter.ts` and `starter-abilities.ts` to the tables above.
- [ ] **Step 4:** Green. `npx vitest run src/engine/content/pack/starter.test.ts`.
- [ ] **Step 5:** Commit — `git commit -m "A pack of our own"`.

---

## Task 3: Stand the demo on it

**Files:** `src/game/demo-scene.ts`.

- [ ] **Step 1:** `SRD_CHARACTERS` becomes `STARTER_CHARACTERS`, built from the starter pack rather than `importContentPack({ …json })`. Leave the eight JSON imports in place, unused, for slice 3 to remove — cutting them here would break nothing but would hide what slice 3 must do. This compiles: `tsconfig.json` sets `strict` but not `noUnusedLocals`, so an unused import is not an error here. Say so in the commit, or the next reader will take it for an oversight.
- [ ] **Step 2:** `SRD_ADVERSARIES` becomes the starter adversaries, indexed by id. `DEMO_ADVERSARY_ID` becomes `'hollow-knight'`.
- [ ] **Step 3:** `PARTY_SHEETS` re-points: `kara` → `sentinel`/`stoneborn`/`ringmail`/`longsword`/`shieldbearer`/`['power-slash','iron-stance']`; `finn` → `cutpurse`/`sylvan`/`padded-coat`/`hunting-bow`/`lampsnuffer`/`['quick-hands','backstab']`; `mira` → `emberwright`/`human`/`padded-coat`/`ember-staff`/`flamecaller`/`['arcane-ward','healing-word']`.
- [ ] **Step 4:** `DEMO_MODELS` maps the new class ids onto the existing procedural bodies: `sentinel: 'knight'`, `cutpurse: 'rogue'`, `emberwright: 'mage'`, and the new adversary ids onto `husk`/`bramble` as suits them. These are the engine's own art and do not change.
- [ ] **Step 5:** `npx vitest run` — expect failures in the files that name the old ids. That is Task 4.

---

## Task 4: Re-point what names the old ids

Fifteen files name `guardian`, `rogue`, `wizard`, `broadsword` and the rest; eleven are tests. A patch script handles the mechanical ones; each remaining failure is read and fixed on its own terms, because a test asserting "Guardian has 7 HP" is asserting about content that no longer exists and may need rewriting rather than renaming.

```
src/editor/authored-scenario.test.ts   src/engine/content/srd/library.test.ts
src/editor/party-edits.test.ts         src/engine/render/authored-view.test.ts
src/editor/ui/PartyPanel.tsx           src/engine/script/abilities.test.ts
src/engine/character/progression.test.ts  src/game/demo-roster.test.ts
src/engine/character/sheet.test.ts     src/game/demo-scene.ts
src/engine/content/abilities.test.ts   tests/e2e/demo.spec.ts
src/engine/content/srd/abilities.ts    tests/e2e/placement.spec.ts
src/engine/render/procedural/library/heroes.ts
```

`heroes.ts` is the **renderer's own art** — `knight`, `rogue`, `mage` are model ids, not class ids. It does not change; only `DEMO_MODELS`' mapping onto it does.

`content/srd/*` keeps naming SRD ids: those files are deleted in slice 3 and re-pointing them is wasted work.

- [ ] **Steps:** run the suite, fix by file, re-run until green, then `npx playwright test`. Commit.

---

## Task 5: Say what the engine ships with

- [ ] Update `DEVELOPING.md` §10: the engine ships one original pack, what is in it, and that a project may carry its own.
- [ ] `MANUAL.md`: the party, classes and adversaries a designer now sees.
- [ ] Re-pin `BACKLOG.md` to the last code commit with the three numbers.
- [ ] Commit.

---

## Done means

- `tsc` clean, `vitest` green, `playwright` green.
- The app boots, the demo plays, and the party is three original classes.
- Nothing in `src/game/` or `src/engine/` outside `content/srd/` names a vendored id.
- `tools/srd-sources/` is still present and still importable — slice 3's job, not this one's.
