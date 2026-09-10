# PolyHeart — Backlog and agent startup notes

For whoever picks this up next. `docs/DEVELOPING.md` says how to extend the engine and
`docs/CRPG-GAPS.md` audits what exists; this file says **what to build next** and carries the
handful of working rules that are learned the expensive way rather than read.

**Pinned to commit `b8b4c0c`.** At that commit: `npx tsc --noEmit` clean, **1669 unit tests across
77 files**, **79 Playwright tests** (about 2.7 minutes). If those numbers come back lower, something
was lost — check before building on it. Symbol names are the stable handles here; line numbers move.

---

## 1. Reading order

Do not read the sources first. Forty minutes of reading below saves a day.

| Order | File | Why |
|---|---|---|
| 1 | `docs/CONTEXT.md` (137 lines) | The goal, the hard constraints, the stack, the SRD sourcing. The working agreement. |
| 2 | **this file** | What to build, and the rules that are not written anywhere else. |
| 3 | `docs/DEVELOPING.md` (769 lines) | Extending the engine: layer map, invariants, recipes, gotchas. A reference to look things up in, not a tutorial. **§11 Gotchas earns its reading twice.** |
| 4 | `docs/CRPG-GAPS.md` (625 lines) | The honest audit against the CRPG goal. Read the relevant section before claiming a system exists or is missing. |
| 5 | `.claude/skills/run-the-demo/SKILL.md` | Driving the app in a real browser. Read it before writing any Playwright of your own. |

`docs/MANUAL.md` is user-facing: playing the demo and authoring content, every panel and field.
`docs/ADVERSARIES.md` and `docs/CARDS.md` are **generated** — editing them by hand is work the next
`python tools/*-doc.py` throws away. `docs/research/legacy-*.md` are static-analysis notes on the
prototype with `file:line` anchors; read those instead of re-reading `legacy/`.

---

## 2. The backlog, ranked

Ranked by **what it adds to a fight** — the house rule for ordering slices. The GM's narrative half
is deliberately last. A *slice* is one behaviour complete: rule, content, editor field, validation,
tests, docs. Half a slice gets finished by someone with less context.

### 1. Movement Under Pressure — the rule is written and nothing calls it

`moveUnderPressure` in `engine/combat/area.ts` implements SRD 2.0 (a PC repositions within Close as
part of an action roll, otherwise an Agility Roll; an adversary moves within Close free, or Very Far
as an action) and `area.test.ts` pins it. **It has zero callers in `src/game/`.** The demo instead
clamps a fighting walk to `combatReach` and logs "*<name> can go no further this turn.*"

*Done means:* `moveSelectedTo` offers the Agility Roll when a click lands past Close in a fight
rather than silently walking as far as it can — the refusal becomes a prompt with a roll behind it,
answered through the same `pending` channel as a script's check. The adversary side reads the same
function so the GM's turn stops inventing its own budget.

### 2. The pending ambush does not survive a save

`demo.ambush` (the encounter a walk woke, held until the tokens arrive) is not in `saveSchema`
(`game/save.ts`). Pressing Save while the party walks into the vault restores them standing on the
trigger with no fight and nothing to wake it.

*Done means:* the field round-trips, or the save refuses mid-walk the way it already refuses
mid-fight. Refusing is the smaller change and probably the right one.

### 3. Materials and a file picker for imported models

`CRPG-GAPS.md` §9. Textures come with a glTF file but nothing authors materials, and there is no file
picker — a model is a URL the page can reach, which means an author cannot add a model from disk in
the editor at all.

### 4. Content depth: the unscripted remainder

47 of 189 domain cards are text only, and 292 of 417 adversary features are left to the GM to
narrate. Both generators refuse to build if an unscripted entry has no stated reason, so
`docs/CARDS.md` and `docs/ADVERSARIES.md` count themselves — **do not hand-count, and do not hand-edit
those files.** Scripting a feature is a short, well-shaped slice; `DEVELOPING.md` §7(c) is the recipe.

### 5. The stated efficiency goals are unmet

`CONTEXT.md` names instancing, batching, culling, LOD, typed arrays and measured budgets. Instancing
and geometry sharing exist (`terrain-mesh.ts`, `procedural/build.ts` with `PrimitiveCache` and
`MaterialLibrary`). **There is no frustum culling and no LOD, and no budget is measured.** Either
build them or amend `CONTEXT.md`; leaving a stated goal unmet and unmarked is the defect.

### 6. Zip project export

`fflate` is a dependency and is imported nowhere under `src/`. `CONTEXT.md`'s "zip import and export
of projects with assets" is not implemented — export is `JSON.stringify` into a `Blob`, so a project
with imported assets cannot be handed to anyone as one file.

### 7. Cleanup: the dead `@content/*` alias

`@content/*` resolves to `content/*` and **there is no `content/` directory at the repo root.**
`CONTEXT.md` lists all four aliases without qualification. Content actually lives in
`src/engine/content/` and in the project document. Delete the alias or point it somewhere real.

---

## 3. Known doc drift

Fix these when you are next in the file; each is one line.

- **`docs/CRPG-GAPS.md`, the tail section ("How to tell whether this is on track")** still says
  *"today a conversation is a literal in `game/demo-dialogue.ts`"* and calls dialogue authoring the
  remaining gap. Stale: `editor/ui/DialogueGraph.tsx` and `editor/dialogue-edits.test.ts` exist, and
  §2 of the same file correctly says the Dialogue panel is done. The tail paragraph predates it.
- **`docs/DEVELOPING.md`** pins its line counts and anchors to commit `058c3af`; HEAD is well past it.
  The symbol names still resolve.

---

## 4. Working rules that `DEVELOPING.md` §11 does not cover

§11 has the environment traps — the space in the path, the ports, `legacy/`, no lint, `grep -a`, no
TTS, English only. These are the process ones, learned the expensive way.

### Editing files: use a Python patch script, not the shell

**Multi-line inline scripts through the Bash tool break on this machine, and `python -` hangs** and
has to be killed. Write the script to **your scratchpad directory** with the Write tool, then run
`python <path>`. Two passes: assert every anchor before writing anything, so a bad anchor cannot
leave a half-patched tree.

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
