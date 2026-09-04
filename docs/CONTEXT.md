# PolyHeart Engine — Working Context (read this first)

**Absolute project path (has a space — always quote it):** `C:\Users\joaoo\daggerheart game`
(Git Bash form: `"C:/Users/joaoo/daggerheart game"`). The user home dir contains non-ASCII characters; never hardcode it.

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
- Daggerheart SRD data (cloned community repos, DPCGL):
  - `C:\Users\JOOBEN~1\AppData\Local\Temp\claude\C--Users-joaoo-daggerheart-game\fcbffdc0-9886-45e6-8949-ab5ea521b4be\scratchpad\srd\daggerheart-data`
    — daggersearch JSON with schemas (`core/*.json`, `_schemas/*.schema.json`): ancestries, armors, classes,
    communities, consumables, domain-cards, items, rules, subclasses, weapons. Good ids and enums. No adversaries.
  - `...\scratchpad\srd\daggerheart-srd` — seansbox: Markdown per entry (`adversaries/`, `environments/`, `classes/`, …)
    plus `.build/03_json/*.json` (UTF-8 **with BOM** — decode with utf-8-sig / strip BOM). Has adversaries (129),
    environments (19), beastforms (24). Stringly typed (`"atk": "+3"`, `"thresholds": "8/15"`, `"damage": "1d12+2 phy"`).
  - `...\scratchpad\srd\og-dhsrd` — Old Gus' hypertext SRD 2.0 (HTML) — rules text reference.
- Official SRD PDF v2.0 (Aug 2026): https://www.daggerheart.com/wp-content/uploads/2026/08/DH_SRD_2_2026_08_25.pdf

## Conventions

- Engine core (`src/engine/**` except `render/`, `audio/`, `input/`) must be **DOM- and WebGL-free** so it runs under
  Vitest in node. Rendering binds to engine state through explicit view/adapter layers.
- Every module ships with unit tests next to it (`*.test.ts`) or under `tests/unit/`.
- Before returning, an implementing agent runs `npx tsc --noEmit` and `npx vitest run <its files>` and reports results
  truthfully.
- Content ids are stable kebab/snake strings; never rely on array order.
- Seeded RNG everywhere the rules roll dice (tests must be deterministic).
- Report anything you could not verify explicitly instead of implying it works.
