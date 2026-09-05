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
  "This product includes materials from the Daggerheart System Reference Document 1.0, © Critical Role, LLC. under the
  terms of the Darrington Press Community Gaming (DPCGL) License. More information can be found at
  https://www.daggerheart.com." Daggerheart is a trademark of Critical Role, LLC; this project is unaffiliated.

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
`@content/*` → `content/*`.

Dev server: `npm run dev` → http://127.0.0.1:8420. Playwright starts its own server on port 8421.

## Source material available locally

- Legacy prototype (what the user built, to be ported/superseded): `legacy/js/*.js`, `legacy/README.md`.
  Static analysis of it lives in `docs/research/legacy-{game,campaign,editor-ui,models}.md` — read those before
  re-reading the legacy sources; they carry `file:line` anchors and a port verdict per behaviour.
- Daggerheart SRD material is **vendored into the repo** (DPCGL) under `tools/srd-sources/` — no network or
  scratchpad needed. Both sets are plain UTF-8 (no BOM), and both are **SRD 1.0**.

  **Rules text — use `tools/srd-sources/seansbox/README.md`.** It is a verbatim reproduction of SRD 1.0
  (ver Sep-09-2025), 2757 lines, with headed sections. Ranges read so far: 409–500 (spotlight, turn order,
  action rolls, GM moves), 573–700 (Hope & Fear, Evasion, HP & damage thresholds, Stress, attacking, damage,
  critical damage, resistance/immunity, range bands), 725–832 (conditions, downtime/rests, death moves,
  additional rules incl. rounding up), 1262–1276 (armor, reducing incoming damage), 1988–2100 (adversary stat
  block anatomy, roles, standard passives). Quote it, and cite the section in the code comment.

  `tools/srd-sources/daggersearch/core/rules.json` is a **terse summary, not the rules text** — it has known
  defects (the Failure-with-Fear bullet has Hope/Fear swapped, its critical-damage line contradicts the verbatim
  text, and its Range Bands entry omits Melee). Use it only as a cross-check.

  **Structured data — use `tools/srd-sources/daggersearch/core/*.json`.** Well-typed, with JSON Schemas in
  `_schemas/*.schema.json`: ancestries, armors, classes, communities, consumables, domain-cards, items, rules,
  subclasses, transformations, weapons. Names/descriptions are localized objects (`{"en-US": "…"}`).
  **No adversaries, no environments.**

  `tools/srd-sources/seansbox/*.json` fills those gaps but is stringly typed (`"atk": "+3"`,
  `"thresholds": "8/15"`, `"damage": "1d12+2 phy"`, `"tier": "1"`): **adversaries (129)**, environments,
  beastforms (24), abilities, plus its own ancestries/classes/armor/weapons/items/subclasses.
  `src/engine/content/srd/seansbox-adversaries.ts` normalizes the adversaries; `tests/unit/srd-content-strings.test.ts`
  asserts all 129 import with zero issues, so add a case there before trusting a new field.

- **House rules the engine adds, where the SRD is silent.** Each is a decision, not a quotation, and each
  is data or a named constant so a project can change it:
  - Line-of-sight geometry and the cover it produces (`src/engine/grid/los.ts`). The SRD names the three
    cover levels and their effects but leaves the geometry to the GM. Default: one blocker gives Light
    Cover, two or more give Full; Total Cover is never inferred, only authored. Thresholds live in
    `LineOfSightRules`.
  - Cover raising an **adversary's Difficulty** (`COVER_APPLIES_TO_ADVERSARY_DIFFICULTY` in
    `src/engine/combat/attack.ts`). The SRD says cover adds to *Evasion*, which is a PC stat.
  - Band-to-tile distances (`DEFAULT_BAND_TILES` in `src/engine/rules/range.ts`), derived from the SRD's
    own distances at 5 ft per tile.
  - Diagonal adjacency (`TargetingOptions.diagonalAdjacency`). It must follow the project's movement rules
    or a diagonal neighbour is out of Melee reach.

- **Open gap: the engine implements SRD 1.0.** The official SRD is now v2.0 (Aug 2026):
  https://www.daggerheart.com/wp-content/uploads/2026/08/DH_SRD_2_2026_08_25.pdf — not vendored, and no 1.0→2.0
  diff pass has been done. When a rule matters, say which version it came from, and say explicitly when a rule
  came from memory rather than from a file in this repo.

## Conventions

- Engine core (`src/engine/**` except `render/`, `audio/`, `input/`) must be **DOM- and WebGL-free** so it runs under
  Vitest in node. Rendering binds to engine state through explicit view/adapter layers.
- Every module ships with unit tests next to it (`*.test.ts`) or under `tests/unit/`.
- Before returning, an implementing agent runs `npx tsc --noEmit` and `npx vitest run <its files>` and reports results
  truthfully.
- Content ids are stable kebab/snake strings; never rely on array order.
- Seeded RNG everywhere the rules roll dice (tests must be deterministic).
- Report anything you could not verify explicitly instead of implying it works.
