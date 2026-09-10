# PolyHeart — Backlog and agent startup notes

For whoever picks this up next. `docs/DEVELOPING.md` says how to extend the engine and
`docs/CRPG-GAPS.md` audits what exists; this file says **what to build next** and carries the
handful of working rules that are learned the expensive way rather than read.

**Pinned to commit `89ca1bf`.** At that commit: `npx tsc --noEmit` clean, **1712 unit tests across
83 files**, **92 Playwright tests** (about 3.4 minutes). If those numbers come back lower, something
was lost — check before building on it. Symbol names are the stable handles here; line numbers move.

---

## 1. Reading order

Do not read the sources first. Forty minutes of reading below saves a day.

| Order | File | Why |
|---|---|---|
| 1 | `docs/CONTEXT.md` | The goal, the hard constraints, the stack, the SRD sourcing. The working agreement. |
| 2 | **this file** | What to build, and the rules that are not written anywhere else. |
| 3 | `docs/DEVELOPING.md` | Extending the engine: layer map, invariants, recipes, gotchas. A reference to look things up in, not a tutorial. **§11 Gotchas earns its reading twice.** |
| 4 | `docs/CRPG-GAPS.md` | The honest audit against the CRPG goal. Read the relevant section before claiming a system exists or is missing. |
| 5 | `.claude/skills/run-the-demo/SKILL.md` | Driving the app in a real browser. Read it before writing any Playwright of your own. |

`docs/MANUAL.md` is user-facing: playing the demo and authoring content, every panel and field.
`docs/ADVERSARIES.md` and `docs/CARDS.md` are **generated** — editing them by hand is work the next
`python tools/*-doc.py` throws away. `docs/research/legacy-*.md` are static-analysis notes on the
prototype with `file:line` anchors; read those instead of re-reading `legacy/`.

---

## 2. The backlog, ranked

### 0. The editor rebuild — the user's direction, ahead of everything below

On 2026-09-10 the user set the editor as the priority, which overrides the fight-first ranking
that follows. There are five parts, each with its own spec, plan and slices:
1. Shell + Inspector
2. 3D multi-level world
3. TaleSpire-style Terrain
4. Combat with factions
5. Interaction graphs

Part 1's spec is `docs/superpowers/specs/2026-09-10-editor-shell-design.md`, and its slice plans
are in `docs/superpowers/plans/`. Part 2 starts from `docs/research/multilevel-dependency-map.md`.

**Done:** part 1, slice 1 (the shell's frame).
**Next:** part 1, slice 2 — the board shows the document, and objects get models.

Ranked by **what it adds to a fight** — the house rule for ordering slices. The GM's narrative half
is deliberately last. A *slice* is one behaviour complete: rule, content, editor field, validation,
tests, docs. Half a slice gets finished by someone with less context.

**Keeping this list true is part of landing a slice.** When one lands, delete its item here, record
it in the matching `CRPG-GAPS.md` section as done, and re-pin the commit and suite numbers in the
header above. A backlog nobody prunes is wrong within a week, and then it costs the next agent the
startup time it was written to save.

### 1. Movement Under Pressure — the rule is written and nothing calls it

`moveUnderPressure` in `engine/combat/area.ts` implements SRD 2.0 (a PC repositions within Close as
part of an action roll, otherwise an Agility Roll; an adversary moves within Close free, or Very Far
as an action) and `area.test.ts` pins it. **It has zero callers in `src/game/`.** The demo instead
clamps a fighting walk to `combatReach` and logs "*<name> can go no further this turn.*"

*Done means:* `moveSelectedTo` offers the Agility Roll when a click lands past Close in a fight
rather than silently walking as far as it can — the refusal becomes a prompt with a roll behind it,
answered through the same `pending` channel as a script's check. The adversary side reads the same
function so the GM's turn stops inventing its own budget.

### 2. Materials and a file picker for imported models

`CRPG-GAPS.md` §9. Textures come with a glTF file but nothing authors materials, and there is no file
picker — a model is a URL the page can reach, which means an author cannot add a model from disk in
the editor at all.

### 3. Content depth: the unscripted remainder

47 of 189 domain cards are text only, and 292 of 417 adversary features are left to the GM to
narrate. **The cards generator refuses to build when a text-only card carries no reason**, so
`docs/CARDS.md` keeps that count honest by itself; `docs/ADVERSARIES.md` groups its reasons rather
than enforcing them. Both are generated — **do not hand-count, and do not hand-edit either file.**
Scripting a feature is a short, well-shaped slice; `DEVELOPING.md` §7(c) is the recipe.

### 4. The stated efficiency goals are unmet

`CONTEXT.md` names instancing, batching, culling, LOD, typed arrays and measured budgets. Instancing
and geometry sharing exist (`terrain-mesh.ts`, `procedural/build.ts` with `PrimitiveCache` and
`MaterialLibrary`). **There is no frustum culling and no LOD, and no budget is measured.** Either
build them or amend `CONTEXT.md`; leaving a stated goal unmet and unmarked is the defect.

### 5. Zip project export

`fflate` is a dependency and is imported nowhere under `src/`. `CONTEXT.md`'s "zip import and export
of projects with assets" is not implemented — export is `JSON.stringify` into a `Blob`, so a project
with imported assets cannot be handed to anyone as one file.

---

## 3. Known doc drift

The stale dialogue-authoring paragraph was corrected on 2026-09-10. `DEVELOPING.md` now
labels its old line anchors as historical; use symbol names to find current implementations.

Completed in the 2026-09-10 working tree: ambush checkpoints are refused with an explanatory
message, and `@content/*` resolves to the real content directory in Vite and TypeScript.
The card collection has domain frames, full-text inspection, search and domain filters,
responsive layout, keyboard navigation and active/vault swaps. Each card's art is generated
from its own id and domain (`ui/card-sigil.ts`), so a fresh clone draws a complete card with
nothing to download. The card-art audit that followed closed the packaging hole: private
directory artwork is kept out of production bundles while other public assets are preserved
(`tools/build-public-assets.ts`), an image that fails to load falls back to the emblem, and the
indexer handles uppercase extensions. Packaging and browser regression tests cover all three.

---

## 4. Working rules that `DEVELOPING.md` §11 does not cover

§11 has the environment traps — the space in the path, the ports, `legacy/`, no lint, `grep -a`, no
TTS, English only. These are the process ones, learned the expensive way.

### Editing files: use a Python patch script, not the shell

**A heredoc carrying a script has failed here more than once** — the shell parses the payload and
dies on an apostrophe or a brace — and **`python -` hangs** and has to be killed off. A heredoc
carrying *prose* is fine; `git commit -F -` that way is the normal path. For edits: write the script
to **your scratchpad directory** with the Write tool, then run `python <path>`. Two passes, so a bad
anchor cannot leave a half-patched tree.

```python
import io

def plan(steps):
    for p, old, _ in steps:
        t = io.open(p, encoding='utf-8').read()
        assert t.count(old) == 1, (p, t.count(old), old[:80])
    for p, old, new in steps:
        t = io.open(p, encoding='utf-8').read()
        io.open(p, 'w', encoding='utf-8', newline='').write(t.replace(old, new))
```

**`newline=''` is not optional.** The repo is LF (`.gitattributes` sets `* text=auto eol=lf`), and
Python's default text mode on Windows rewrites every `\n` to `\r\n` on the way out — one careless
write turns a whole file into a CRLF diff. When an anchor is ambiguous the assertion tells you the
count; extend it with the preceding line rather than reaching for a blind replace-all.

### Never `git checkout` a file with uncommitted work in it

To prove a new test fails without its fix, copy the file aside and copy it back. A `checkout` of a
dirty file throws away work that is not recoverable.

### The e2e suite hand-mirrors the driver type

`src/main.ts` declares `window.__polyheart` in a `declare global` block, and
`tests/e2e/demo.spec.ts` **declares its own copy of that type near the top.** Adding a handle to
`main.ts` without adding it to the spec is a `tsc` failure in the test, not in the app, which reads
as unrelated. Update both in the same patch.

### Driving a fight headless

`setDiceSpeed(0)` first or the dice animation makes everything wait. A move that wakes an encounter
does **not** start it until the tokens arrive — call `arrive()` after the move, or wait for
`gliding() === 0`, before reading `inCombat()`. Copy `intoTheVault` from
`tests/e2e/playpass.spec.ts` rather than writing a route. The skill has the rest, including the four
things that waste an hour.

### Manhattan distance stays

The nearest-creature sorts use Manhattan distance **by the user's explicit decision.** Do not propose
Euclidean again. Range *bands* are a separate matter and go through `bandForSpan` — every tile-to-tile
measurement in the engine does.

### Look at screenshots, and send them

`await page.screenshot({ path: 'test-results/whatever.png' })`, then actually read the image. It
catches the class of defect where the engine is right and the presentation is not — a condition
printed by the id it is keyed by rather than its name, which every unit test agreed with because they
assert on ids too. Send anything the user should see with **SendUserFile**: they follow this work
from a phone and will not scroll a terminal.

### Before claiming done

`npx tsc --noEmit`, `npx vitest run`, **and** `npx playwright test`. All three, every time — the e2e
suite is the only thing that catches a broken boot, and it takes under three minutes. Every commit
body carries a verification line saying what was run and what came back, then a sentence on how the
new tests were shown to fail without their fix. If something could not be verified, say that instead
of implying it works.

### Commit and report

Commit messages are a sentence about the behaviour, not the files. The body explains the design
decision and why the alternative was rejected. **The `Co-Authored-By` and `Claude-Session` trailer is
whatever the current session hands you** — do not copy the one in `DEVELOPING.md` §9, which is an
example from an older session. A review that follows a slice lands as its own commit that says so;
do not amend the reviewed commit, because the pair is the record.

Close every reply to the user with a **ranked** recommendation of what to do next, unprompted.
