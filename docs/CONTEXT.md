# Tactical Engine — Working Context (read this first)

**The project path contains a space — always quote it.** The repo has moved between machines
before, so prefer repo-relative paths in code, scripts and docs, and never hardcode a path or a
home directory.

## Goal

Turn the original prototype into a **full CRPG engine + editor** for making party-based tactical RPGs in the style of
Baldur's Gate 3, running a dual-dice tabletop ruleset (paired resolution dice, Light/Shadow, Stress, damage thresholds,
Armor Slots, domains/cards, classes/subclasses, ancestries/communities, adversaries with Shadow features, rests, leveling).

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
- **No SRD material is vendored any more.** `tools/srd-sources/` held the official 2.0 text and two
  community data sets; it is gone, along with the card and adversary libraries built from it. The
  engine ships `src/engine/content/pack/starter.ts` — its own high-fantasy pack, nobody else's
  content — and reads anything else as an imported pack, through **Project ▾ → Import pack…**
  (`src/engine/content/pack/document.ts`).

  The catalogue was not discarded. `tools/export-pack.ts` (deleted with the sources, retrievable
  from history) wrote it out as `packs/srd.json`, the content as one `contentPackSchema` document,
  and `packs/srd-abilities.json`, the 185 ability scripts and 54 conditions that content runs on,
  in the shape `projectSchema` accepts. Both are **gitignored**: an export is for whoever holds the
  rights to it, not something this repository ships; both import whole through that menu. Three
  of the four native hooks in
  `src/engine/script/native-hooks.ts` exist for cards in that pack — `{ kind: 'run', hook: '…' }`
  is a computation the effect vocabulary cannot express — which is why that module stayed behind
  when the content went.

  **What the 2.0 diff settled, which outlives the text it was read from.** A full section-by-section
  pass against 1.0 was done on 2026-09-05. Almost everything was identical — action rolls and the
  five outcomes, critical damage, damage thresholds and 1/2/3 HP, optional Massive Damage, the GM's
  d20 against Evasion with a natural-20 crit, Light 6 / Shadow 12, Stress 6→12, Armor Score cap 12,
  resistance and immunity, direct damage, death moves, rests, conditions, range bands. What changed,
  and what the engine therefore implements:
  - **Cover and line of sight were replaced.** 1.0 graded cover Light / Full / Total, worth
    +1 / +2 Evasion, with Total meaning "cannot be targeted". In 2.0 those three strings do not
    appear at all: a ranged attacker needs line of sight, a *partial* obstruction gives the target
    **cover**, an attack through cover is rolled with **disadvantage**, and a *total* obstruction
    means there is simply no line of sight. `src/engine/rules/cover.ts` and `src/engine/grid/los.ts`
    implement 2.0; the 1.0 model is gone.
  - **Area of Effect** is 2.0's: a group effect's targets must be within Very Close of one origin
    point inside the effect's range (`src/engine/combat/area.ts`).
  - **Movement Under Pressure** is 2.0's: a PC may reposition within Close range as part of an
    action roll, otherwise an Agility Roll; an adversary moves within Close free, or Very Far as an
    action (same file, called by the fight walk and the GM's approach in `game/demo-scene.ts`).
  - 2.0 states explicitly what 1.0 only implied: "a player never rolls more than one advantage or
    disadvantage die on the same roll". The engine already worked this way.

  The community sets were SRD **1.0** and were never safe to quote for a rule — fine as content,
  wrong as rules. `daggersearch/core/rules.json` in particular was a terse summary with known
  defects (its Failure-with-Shadow bullet swapped Light and Shadow, and its critical-damage line
  contradicted the verbatim text of *both* 1.0 and 2.0). That is recorded because it explains why
  the engine's numbers came from the official text rather than the convenient JSON.

- **House rules the engine adds, where the SRD is silent.** Each is a decision, not a quotation, and each
  is data or a named constant so a project can change it:
  - What makes an obstruction *partial* rather than *total* (`src/engine/grid/los.ts`). 2.0 introduces the
    distinction but does not define the geometry. The engine's answer: running squarely into a blocking tile
    is total; clipping a corner where only one of the two tiles blocks is partial, and gives cover.
  - Band-to-tile distances (`DEFAULT_BAND_TILES` in `src/engine/rules/range.ts`), derived from the SRD's
    own distances at 5 ft per tile.
  - Distance is as the crow flies, to the nearest tile (`bandForSpan` in `src/engine/rules/range.ts`),
    everywhere: an attack, an area, a script's walk, the picture. These rules are not played on a grid, so
    a diagonal neighbour is Melee and a fight's move is a Close-range disc (`MovementContext.maxSpan`),
    not a count of steps. The tiles are a navmesh underneath, never a rule.
  - Which target's scales a check reads when it names several
    (`SceneScriptWorld.advantageAgainst`). Vulnerable is "all rolls targeting you" and Hidden is "any rolls
    against you", so a Spellcast Roll reads them as an attack does — but a check is *one* roll and may name a
    group. The engine takes the best any target grants and the worst any target imposes, added: one Vulnerable
    creature in the group gives the die, one Hidden creature costs it, and they cancel as dice always do.
  - **When a check's own Light is spendable by the check's own arms.** A check hands over the Light it rolled
    *before* it runs `onSuccess…`/`always`, so a card whose arm branches on the pool sees it — a roll with Light
    can pay for its own effect. Not a card quirk: every `branch` on a pool inside a check inherits it. Named on
    `wrangle`, where it first mattered — that card left with the catalogue, and the rule did not.
  - **What a card offers versus what it simply does**, where the SRD says "spend a Light to…" inside an effect
    rather than as a cost. Wrangle spends it whenever there is one, because a wrangle nobody wanted is a card
    nobody would have played; Support Tank always throws the Shadow Die rather than asking which, it being the one
    anybody would pick. Both are decisions there is nobody at that end of the table to make.

  *(The 1.0-era house rule "cover raises an adversary's Difficulty" is gone: 2.0 puts cover on the attack
  roll as disadvantage, which applies identically to either side and needs no engine decision.)*

## Where to go next

`docs/BACKLOG.md` is the ranked list of what to build next and carries the working rules that are not
written anywhere else - the patch-script protocol, the `window.__engine` type mirror in the e2e
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
