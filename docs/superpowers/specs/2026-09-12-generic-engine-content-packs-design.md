# A generic tactical engine, with content as importable packs

**Status:** design, awaiting review. No code changed yet.

## 1. Why

The project is a video game engine. The owner's position is that the Darrington Press Community
Gaming License grants nothing for software or video game distribution, so the project operates under
general copyright, patent and trademark law, and must carry no Daggerheart intellectual property.

That position is the requirement this design implements. It is not re-argued here, and nothing below
is legal advice.

What follows from it, in the owner's words: game rules, mathematical systems and functional
procedures are not copyrightable and may be implemented in original code; names, verbatim text, the
proprietary content catalogue, art, and the paired-term branding may not be used at all.

**The owner's own conclusion sets the architecture:** an engine that lets people define their own
dice, domains and cards through external data is clean. So the engine becomes the generic base, and
everything that carries someone else's IP becomes an importable pack — including, one day, a
Daggerheart pack, if the rights were ever held. Nothing the owner has built is thrown away; it stops
being *inside the product*.

## 2. The shape

Three layers, only the first of which ships:

| Layer | What it is | Ships in the repo |
|---|---|---|
| **Engine** | Mechanics, renderer, editor, rules. Knows no catalogue. | Yes |
| **Pack** | Data: classes, ancestries, cards, adversaries, items, conditions. | Only a small original starter pack |
| **Project** | A campaign: scenes, scripts, party — and the packs it uses. | The user's own files |

The engine is already most of the way here, which is why this is a refactor rather than a rewrite:

- `content/srd/daggersearch.ts` exposes eight importers — `importWeapons`, `importArmors`,
  `importClasses`, `importAncestries`, `importCommunities`, `importSubclasses`, `importDomainCards`,
  `importCharacterContent` — each taking `raw: readonly unknown[]`. They are generic readers named
  after a source.
- `SrdCharacterContent` is already a pack shape: seven `ReadonlyMap`s.
- `character/sheet.ts` takes `content: SrdCharacterContent` as a **parameter**. Nothing is hardcoded.
- `SRD_ABILITIES` is `RAW.map((raw) => abilitySchema.parse(raw))` — data against a published schema,
  already serialisable.
- `projectSchema` already carries `abilities`, `conditionDefs`, `items`, `lootTables`, `quests`,
  `code`, `party` and `terrainPalette`.

The only hard coupling is **eight build-time JSON imports, all in `src/game/demo-scene.ts`**
(lines 13, 47–53).

## 3. What the engine keeps

The mechanics stay, as original code. They are the product:

dual-dice resolution with a paired secondary resource · damage thresholds against tiers with discrete
HP pips · armour slots as consumable charges that step damage down · a secondary stress pool ·
initiative-free action economy where the GM acts on failure · card-slot loadouts with a larger vault ·
advantage and disadvantage dice · situational tagged modifiers · range bands · conditions ·
countdowns · the renderer, the editor, construction, and everything built in the last four slices.

## 4. What leaves

| What | Size | Why |
|---|---|---|
| `tools/srd-sources/` | 2.1 MB, 64 files | Vendored third-party text |
| `content/srd/abilities.ts` | 181 KB | Scripts keyed to the proprietary card catalogue |
| `content/srd/adversary-abilities.ts` | 162 KB | Same, for stat-block features |
| `content/srd/seansbox-adversaries.ts` | 10 KB | Importer bound to a specific 1.0 data set |
| `docs/CARDS.md`, `docs/ADVERSARIES.md` | 80 KB | Generated derivatives of vendored text |
| `tools/cards-doc.py`, `tools/adversaries-doc.py` | — | Their generators |
| Quoted rule text in shipped strings | e.g. `content/conditions.ts:669` | Verbatim text, user-facing |
| Citations naming the SRD | 27 lines, 16 files | Rewritten in original words |
| The marks | 45 files | Trademarks |

**Nothing is lost.** A one-shot export tool writes today's catalogue — 189 cards, 129 adversaries,
9 classes, 18 ancestries, and the scripted mechanics for them — as pack JSON into a **gitignored
`packs/` directory**. It remains on the owner's disk, loadable by the engine, never distributed.
The scripting work survives as data rather than as source.

## 5. The pack format

`SrdCharacterContent` becomes `ContentPack`; `content/srd/` becomes `content/pack/`; the importers
keep their signatures and lose the source from their names.

`projectSchema` gains the seven fields it lacks, each defaulted so every existing project still
parses — the same pattern `assets`, `quests` and `adversaryModels` already follow:

```
classes, ancestries, communities, subclasses, domainCards, weapons, armors
```

A project may therefore carry its whole catalogue, exactly as it already carries abilities and
conditions. Packs are imported through the existing project load path; no new runtime is invented.

## 6. The renames, and the migration

`hope` → `light`, `fear` → `shadow`, across 71 source files. This is a **document format change**,
not only a rename. Persisted names carrying the terms:

- `poolNameSchema`: `'hope'` → `'light'`
- the pool selector enum `'hope' | 'fear' | 'both'`
- four `checkRequestSchema` keys: `onSuccessWithHope`, `onSuccessWithFear`, `onFailureWithHope`,
  `onFailureWithFear` (real persisted keys — the `get` accessors are zod's lazy idiom for the
  circular `effectSchema` reference, not aliases over another store)
- four `RollOutcome` values: `successWithHope` … `failureWithFear`

`formatVersion` goes **1 → 2**, with a load-time migration that rewrites a version-1 document rather
than rejecting it, so existing saved projects keep working. The rename also reaches UI labels
(`DiceTray` builds `Hope N + Fear N` and the outcome phrasing; `PartyHud` renders pips labelled
Hope and Fear) and the `hope`/`fear` test ids those pips carry.

17 files name the outcome fields, 17 name the outcome values, 4 test files touch the terms.

## 7. The starter pack

Play mode stays, and the character system becomes content-driven rather than deleted. The repo ships
one small **original** pack so the engine runs out of the box:

- 3 classes, with original names and features
- generic ancestries drawn from public-domain fantasy tropes
- ~15 ability cards, original text, exercising the effect vocabulary
- ~10 adversaries across the tiers
- the conditions and items the engine's own rules read

Sized to keep the ~400 game-layer tests meaningful, not to be a game.

## 8. `legacy/`

The standing rule that `legacy/` is never modified is **amended by the owner's ruling**. All eight
marks there are cosmetic — comments in `campaign.js`, `data-campaign.js`, `game.js`, the README, and
one editor hint string at `editor.js:124`. None is a functional value; `legacy/js/data.js`, which
`main.ts` imports `demoMap` from, carries none. Purging is a prose rewrite and cannot break the demo.
`CLAUDE.md`, `AGENTS.md` and `CONTEXT.md` record the amendment.

## 9. Identity

`package.json` name `daggerheart-engine` → `tactical-engine`; the description loses the marks. The
product becomes **Tactical Engine**, matching the repository. **PolyHeart is retired** — its echo of
the product being separated from is the whole reason to drop it. Applied across the editor title,
docs, `CLAUDE.md` and `AGENTS.md`.

## 10. The guard

`tests/unit/licensing-boundary.test.ts` already pins `.gitignore` and scans `src/`. It is extended to
fail on: the marks in any tracked file; any path under `tools/srd-sources/`; the retired product
name; and the paired terms as identifiers. The boundary becomes enforced rather than remembered —
the same reason the card-art rule is a test rather than a note.

## 11. Non-goals

- Not a rules change. Every mechanic behaves as it does today.
- Not a renderer, editor or construction change.
- Not materials authoring for imported models (still open, `CRPG-GAPS` §9).
- Not a re-argument of the licensing position.

## 12. Slices

1. **Pack architecture** — rename `ContentPack`, move `content/srd/` → `content/pack/`, add the seven
   project fields, cut the eight imports. Suite stays green throughout.
2. **Export and purge** — export today's catalogue to gitignored `packs/`, then delete the vendored
   sources, the SRD catalogues, the generated docs and the quoted text.
3. **Renames and migration** — Light and Shadow, `formatVersion` 2 with the load-time migration,
   identity to Tactical Engine, `legacy/` prose.
4. **Starter pack and guard** — author the original content, extend the licensing test.

Each slice ends green: `tsc`, `vitest`, `playwright`.

## 13. Risks

- **The starter pack is authoring, not engineering.** Fifteen original cards that exercise the effect
  vocabulary is the slowest part, and the part most likely to be thin on the first pass.
- **The migration must be exercised on a real version-1 document**, or it is a promise rather than a
  behaviour. A fixture project saved before the change is the test.
- **Slice 2 is destructive.** It runs on a branch; everything deleted stays in git history and in the
  exported pack.
- The e2e suite leans on demo content; renaming the `hope`/`fear` test ids touches selectors.

## 14. Done means

`tsc --noEmit` clean, `vitest` and `playwright` green, the licensing test failing on any
reintroduction, no mark anywhere in a tracked file, a version-1 project still loading, and the app
booting into a playable original starter pack.
