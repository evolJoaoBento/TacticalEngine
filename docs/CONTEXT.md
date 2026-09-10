# PolyHeart Engine — Working Context (read this first)

**Absolute project path (has a space — always quote it):** `D:\New folder\daggerheart game`
(Git Bash form: `"D:/New folder/daggerheart game"`). The repo has moved between machines before — prefer
repo-relative paths in code, scripts and docs; never hardcode a home directory.

## Goal

Turn the PolyHeart prototype into a **full CRPG engine + editor** for making party-based tactical RPGs in the style of
Baldur's Gate 3, but running on the **Daggerheart** rules system (duality dice, Hope/Fear, Stress, damage thresholds,
Armor Slots, domains/cards, classes/subclasses, ancestries/communities, adversaries with Fear features, rests, leveling).

Engine, not just a game: data-driven content, an in-browser editor (terrain, props, imported assets, encounters,
dialogue graphs, quests, triggers/scripts), asset import (glTF/GLB, textures, audio, data packs), save/load, and a
demo project that exercises everything. Efficiency is a stated requirement: instancing/batching, culling, LOD,
typed arrays, no per-frame allocations, measured budgets.

## Hard constraints (from the user and prior sessions)

- **No TTS / voiced narration of any kind.** The user tried Web Speech and Piper, called both garbage, and asked for
  complete removal. Do not re-add narration, speech synthesis, or "voice" features.
- **All content text in English.**
- The user asked for autonomy: decide, build, test, verify. Do not leave questions for the user in code or docs.
- Keep the original prototype runnable: it lives in `legacy/` (open `legacy/start.bat`). Do not modify `legacy/`.
- Daggerheart SRD content is used under the **Darrington Press Community Gaming License (DPCGL)**. Keep attribution:
  "This product includes materials from the Daggerheart System Reference Document 2.0, © Critical Role, LLC. under the
  terms of the Darrington Press Community Gaming (DPCGL) License. More information can be found at
  https://www.daggerheart.com." Daggerheart is a trademark of Critical Role, LLC; this project is unaffiliated.
  (The vendored community *data* sets are SRD 1.0 and carry their own 1.0 attribution; keep both.)

## Chosen stack (verified working on this machine, 2026-09-04)

| Concern | Choice |
|---|---|
| Language / build | TypeScript 7 (strict), Vite 8 (oxc transform; JSX via `oxc.jsx` → Preact) |
| Rendering | three.js 0.185 (npm, pinned), three-mesh-bvh for fast raycasts |
| Dice physics | cannon-es 0.20 (convex d12s, kept from prototype) |
| UI | Preact 10 + @preact/signals (editor panels, HUD, dialogue UI) |
| Content validation | zod 4 schemas; content lives as JSON |
| Project packaging | fflate (zip import/export of projects with assets) |
| Unit tests | Vitest 5 (`npm test`), node environment by default; `happy-dom` available for DOM tests |
| E2E tests | Playwright 1.62 (`npm run test:e2e`), headless chromium with SwiftShader WebGL2 — verified rendering works |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) |

Path aliases: `@engine/*` → `src/engine/*`, `@editor/*` → `src/editor/*`, `@game/*` → `src/game/*`,
`@content/*` → `src/engine/content/*`.

Dev server: `npm run dev` → http://127.0.0.1:8420. Playwright starts its own server on port 8421.

## Source material available locally

- Legacy prototype (what the user built, to be ported/superseded): `legacy/js/*.js`, `legacy/README.md`.
  Static analysis of it lives in `docs/research/legacy-{game,campaign,editor-ui,models}.md` — read those before
  re-reading the legacy sources; they carry `file:line` anchors and a port verdict per behaviour.
- Daggerheart SRD material is **vendored into the repo** (DPCGL) under `tools/srd-sources/` — no network
  needed for anything.

  **Rules text — use `tools/srd-sources/official-2.0/srd-2.0.txt`.** This is the *official* SRD 2.0
  (ver 2026-08-25), extracted from the daggerheart.com PDF; see that directory's README for how, and why a
  naive extraction is unusable. Quote it, and cite the section in the code comment. `===== PAGE n =====`
  markers are preserved; sentences are grep-able in one piece.

  **The engine implements SRD 2.0.** A full section-by-section diff pass against 1.0 was done on 2026-09-05.
  Almost everything is identical — action rolls and the five outcomes, critical damage (add the maximum
  possible dice result), damage thresholds and 1/2/3 HP, optional Massive Damage, the GM's d20 against
  Evasion with a natural-20 crit, Hope 6 / Fear 12, Stress 6→12, Armor Score cap 12, resistance and immunity,
  direct damage, death moves, rests, conditions, range bands. What changed:
  - **Cover and line of sight were replaced.** 1.0 graded cover Light / Full / Total, worth +1 / +2 Evasion,
    with Total meaning "cannot be targeted". In 2.0 those three strings do not appear at all: a ranged
    attacker needs line of sight, a *partial* obstruction gives the target **cover**, an attack through cover
    is rolled with **disadvantage**, and a *total* obstruction means there is simply no line of sight.
    `src/engine/rules/cover.ts` and `src/engine/grid/los.ts` implement 2.0; the 1.0 model is gone.
  - **Area of Effect** is new: a group effect's targets must be within Very Close of one origin point inside
    the effect's range (`src/engine/combat/area.ts`).
  - **Movement Under Pressure** is new: a PC may reposition within Close range as part of an action roll,
    otherwise an Agility Roll; an adversary moves within Close free, or Very Far as an action (same file).
  - 2.0 states explicitly what 1.0 only implied: "a player never rolls more than one advantage or
    disadvantage die on the same roll". The engine already worked this way.

  **Structured data — use `tools/srd-sources/daggersearch/core/*.json`.** Well-typed, with JSON Schemas in
  `_schemas/*.schema.json`: ancestries, armors, classes, communities, consumables, domain-cards, items, rules,
  subclasses, transformations, weapons. Names/descriptions are localized objects (`{"en-US": "…"}`).
  **No adversaries, no environments.**

  `tools/srd-sources/seansbox/*.json` fills those gaps but is stringly typed (`"atk": "+3"`,
  `"thresholds": "8/15"`, `"damage": "1d12+2 phy"`, `"tier": "1"`): **adversaries (129)**, environments,
  beastforms (24), abilities, plus its own ancestries/classes/armor/weapons/items/subclasses.
  `src/engine/content/srd/seansbox-adversaries.ts` normalizes the adversaries; `tests/unit/srd-content-strings.test.ts`
  asserts all 129 import with zero issues, so add a case there before trusting a new field.

  **Both community sets are still SRD 1.0** and neither upstream repo had updated as of 2026-09-05. They are
  fine as *content* — stat blocks, armor and weapon tables are unaffected by the 2.0 rules changes — but never
  quote them for a rule. `daggersearch/core/rules.json` in particular is a terse summary with known defects
  (the Failure-with-Fear bullet swaps Hope and Fear, and its critical-damage line contradicts the verbatim
  text of *both* 1.0 and 2.0).

- **House rules the engine adds, where the SRD is silent.** Each is a decision, not a quotation, and each
  is data or a named constant so a project can change it:
  - What makes an obstruction *partial* rather than *total* (`src/engine/grid/los.ts`). 2.0 introduces the
    distinction but does not define the geometry. The engine's answer: running squarely into a blocking tile
    is total; clipping a corner where only one of the two tiles blocks is partial, and gives cover.
  - Band-to-tile distances (`DEFAULT_BAND_TILES` in `src/engine/rules/range.ts`), derived from the SRD's
    own distances at 5 ft per tile.
  - Distance is as the crow flies, to the nearest tile (`bandForSpan` in `src/engine/rules/range.ts`),
    everywhere: an attack, an area, a script's walk, the picture. Daggerheart is not played on a grid, so
    a diagonal neighbour is Melee and a fight's move is a Close-range disc (`MovementContext.maxSpan`),
    not a count of steps. The tiles are a navmesh underneath, never a rule.
  - Which target's scales a check reads when it names several
    (`SceneScriptWorld.advantageAgainst`). Vulnerable is "all rolls targeting you" and Hidden is "any rolls
    against you", so a Spellcast Roll reads them as an attack does — but a check is *one* roll and may name a
    group. The engine takes the best any target grants and the worst any target imposes, added: one Vulnerable
    creature in the group gives the die, one Hidden creature costs it, and they cancel as dice always do.
  - **When a check's own Hope is spendable by the check's own arms.** A check hands over the Hope it rolled
    *before* it runs `onSuccess…`/`always`, so a card whose arm branches on the pool sees it — a roll with Hope
    can pay for its own effect. Not a card quirk: every `branch` on a pool inside a check inherits it. Named on
    `wrangle` in `src/engine/content/srd/abilities.ts`, where it first mattered.
  - **What a card offers versus what it simply does**, where the SRD says "spend a Hope to…" inside an effect
    rather than as a cost. Wrangle spends it whenever there is one, because a wrangle nobody wanted is a card
    nobody would have played; Support Tank always throws the Fear Die rather than asking which, it being the one
    anybody would pick. Both are decisions there is nobody at that end of the table to make.

  *(The 1.0-era house rule "cover raises an adversary's Difficulty" is gone: 2.0 puts cover on the attack
  roll as disadvantage, which applies identically to either side and needs no engine decision.)*

## Where to go next

`docs/BACKLOG.md` is the ranked list of what to build next and carries the working rules that are not
written anywhere else - the patch-script protocol, the `window.__polyheart` type mirror in the e2e
suite, and what to run before claiming a slice is done. Read it after this file. `docs/DEVELOPING.md`
is the reference for extending the engine; `docs/CRPG-GAPS.md` is the honest audit of what exists.

## Conventions

- Engine core (`src/engine/**` except `render/`, `audio/`, `input/`) must be **DOM- and WebGL-free** so it runs under
  Vitest in node. Rendering binds to engine state through explicit view/adapter layers.
- Conditions and effects have **one** schema, `src/engine/script/schema.ts`, and the runtime types are
  inferred from it. There were once two vocabularies — one a document could hold, one the runner could
  execute — and authored content silently did nothing. Never add a second.
- Every module ships with unit tests next to it (`*.test.ts`) or under `tests/unit/`.
- Before returning, an implementing agent runs `npx tsc --noEmit` and `npx vitest run <its files>` and reports results
  truthfully.
- Content ids are stable kebab/snake strings; never rely on array order.
- Seeded RNG everywhere the rules roll dice (tests must be deterministic).
- Report anything you could not verify explicitly instead of implying it works.
