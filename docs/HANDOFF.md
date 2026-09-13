# Handoff — slice 4 complete, 2026-09-13

Written to move this work to another machine. Read `CLAUDE.md` first, then this, then
`docs/BACKLOG.md`. This file is a snapshot of one session and can be deleted once its "what's next"
is absorbed into `BACKLOG.md`.

**The branch has never been pushed.** Roughly a hundred commits are local-only, twelve of them from
this session. Nothing here reaches another machine through `git pull` until somebody pushes. If you
are moving the tree by copy, copy the whole repo including `.git`, and note that `packs/` and
`public/cards/` are gitignored and will not travel with a clone.

---

## 1. State, measured

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0** |
| `npx vitest run` | **1812 passed / 1 failed (1813)** |
| `npx vitest run tests/unit/licensing-boundary.test.ts` | **6 passed** |
| `npx playwright test` | **103 passed, EXIT=0**, `.last-run.json` `"status": "passed"` |
| Working tree | clean |

**The one failing unit test is deliberate and pre-existing**:
`src/game/demo-defense.test.ts` → *"lifts the lowest of the swing's dice to its highest face"*, a
Stress assertion left red after four attempts rather than guessed at. `BACKLOG.md:55` documents it.
It has been 1 failed with that exact name through every pass in this session — if you see 2 failed,
you broke something.

### How to read a Playwright result

Playwright prints `103 passed (3.7m)` as its **last** line and failures **above** it, so a red run's
final line looks green. Read `EXIT=`, or `test-results/.last-run.json`. A green run is ~3.7 min; a
red one takes 15+ because each failing locator waits out a 90-second timeout, so a slow run is
itself a signal. `vitest` transpiles without type-checking — tests can pass on code `tsc` rejects,
so always run both.

---

## 2. What landed this session (12 commits, oldest first)

| Commit | What |
|---|---|
| `4d17f62` | Phase 1: 686 display sites across 69 files → **Light** / **Shadow** |
| `64b3ade` | Phase 2: 74 files → `good` / `bad` stored (1323 insertions, 1323 deletions — a 1:1 substitution) |
| `09d9d70` | Five tests proving the migration against the real schemas |
| `e165b60` | Card trade dress: two on-screen wordmarks gone, `dh-` class prefix → `face-` |
| `6767b90` | the e2e driver handle became `window.__engine`, 438 sites, 24 files |
| `5838c13` | Retired product name gone from 25 files; docs catch up with Light/Shadow |
| `8cd97e2` | `CLAUDE.md`, `AGENTS.md`, `CONTEXT.md`: marks reduced to the attribution, dead citations removed |
| `ceaca05` | Saves written before the rename keep opening (storage-key fallback) |
| `b5ce271` | Corrected the backlog's false premise about `legacy/` |
| `e213493` | `MANUAL.md`, `CRPG-GAPS.md`, `DEVELOPING.md`, `developer-guide.html`: last marks removed |
| `1a6601e` | **The licensing guard** — the boundary becomes a test |
| `252808a` | Two sentences the rename inverted; backlog records what landed |

---

## 3. Rulings that are binding and not obvious from the code

### Light and Shadow in front, `good` and `bad` behind

The owner's ruling. Player-facing text reads **Light** and **Shadow**. Field names, enum values,
selectors and identifiers are `good` and `bad`.

`light` and `shadow` **cannot** be identifiers here: `spotlight` is the engine's own turn concept
with 249 uses, and the renderer has shadow mapping. That collision is the whole reason the rename
has a front and a back. Do not "simplify" it by unifying them.

`poolNameSchema` is at `src/engine/script/schema.ts:37` and reads
`['hitPoints', 'stress', 'armorSlots', 'good']`. `logToneSchema` is at `:151`. `rollOutcomeSchema`
is at `src/engine/scene/primitives.ts:34` — **not** `dice/primitives.ts`, which does not exist.

### The version-1 fixtures are evidence, not test data

`tests/fixtures/v1/project.json` and `save.json` are **genuine format-version-1 documents**,
captured at commit `977840b` by a tool that was deleted in the same slice because the rename it
existed to prove is what ended it. `tests/fixtures/v1/README.md` carries the provenance.

- **Never hand-edit them and never regenerate them.** Their entire value is that no version-2 code
  ever touched them. Editing one to make a test pass destroys the only evidence the migration has.
- They are `.json` on purpose — every rename pass walked `.ts`/`.tsx` only, which is what kept them
  readable while the rest of the tree moved.
- They still contain the old names (16 compound identifiers in `project.json`). That is correct.

### Files that must keep the old vocabulary

`src/engine/scene/migrate.ts` and `migrate.test.ts` read and table the version-1 field names. A pass
over them would write `renameKey(raw, 'good', 'good')` and the migration would stop migrating **while
every one of its tests still passed** — the failure would only surface when somebody loaded an old
save. `legacy-import.ts:91-94` maps the prototype's own document keys (`hopeSuccess:` and three
siblings); only their values moved. `pack/schema.test.ts:139` asserts `costsFear` is *absent*.

### The seven RNG seeds

`'no-hope'` (twice), `'wolf-fear'`, `createRng('fear')`, `'fear-cost'`, `'tank-hope-'` (twice), plus
`hashSeed('polyheart')` in `rng.test.ts` with its deliberate one-character variant `'polyhearu'`.
A seed's *value* selects a dice sequence. Renaming one silently re-rolls every assertion that
depends on it. This trap cost four cycles earlier in the project on other seeds.

### `legacy/`

`CLAUDE.md` and `AGENTS.md` both list it as never modified. The owner amended that for slice 4's
prose only — and the amendment's stated premise ("all eight marks there are cosmetic comments and
one editor hint, none functional") **was wrong**: there are 20 marks and three are functional
`localStorage` keys (`polyheart-campaign` written at `legacy/js/editor.js:170`, read at
`main.js:23`; `polyheart-map` read at `main.js:29`). Prose was rewritten, keys were left.

`legacy/`'s 59 Light/Shadow sites were also left: 19 are live identifiers in `legacy/js/game.js`,
and `legacy/README.md:50-65` is a table documenting the prototype's mechanics against its own code.

### The storage-key fallback (`ceaca05`)

`save-slots.ts` and `ui/card-art.ts` renamed three live `localStorage` prefixes to `tactical:*` and
read the old `polyheart:*` ones as a fallback. Three rules:

```
get     current key, then legacy
set     current key only
remove  BOTH
```

The third is the one a naive fallback gets wrong — clearing only the current key lets a deleted save
come back on the next read, which presents as the delete button not working. Each store has a test
asserting the legacy key is gone from the backing map afterwards.

Honest note carried in that commit: those tests do **not** fail against the code before the slice,
which read `polyheart:*` natively. They discriminate against the alternative that was actually on
the table — a rename with no fallback and a single-key remove.

---

## 4. The licensing guard — how to work with it

`tests/unit/licensing-boundary.test.ts`. Three sweeps over `git ls-files`, plus the pre-existing
checks on `.gitignore` and `tools/srd-sources/` non-existence.

1. **The marks** (the three terms the rule's own regex names — read it in the test) only where the
   licence requires them. The
   DPCGL *obliges* the attribution, so the rule cannot be "never": an occurrence is legitimate when
   a licensing phrase sits **within ±2 lines**.
2. **The retired product name** gone except lines carrying `polyheart:`, `polyheart-` or
   `'polyheart'` — the persisted keys and the RNG seeds.
3. **The paired terms as identifiers**, excluding five files that name them deliberately.

### Why ±2 lines and not the line

Attribution paragraphs wrap mid-phrase. That file itself splits "System Reference / Document" across
a break at `:10-11`, so a per-line rule fails on the notices themselves. Two drafts of the doc
passes broke exactly this way.

### Exemptions, and the rule about them

`legacy/`, `docs/research/`, `docs/superpowers/` (dated design records — a spec arguing for removing
this IP must be able to name it), and the guard itself (its rules have to spell the terms they
forbid). **When a rule fails, fix the source, not the exemption list.** Two worked examples from
this session:

- Rule 3 caught a real offender on its first run: a comment in `save.test.ts` naming the old pool
  field. It was reworded. Adding `save.test.ts` to the exemptions would have blinded the rule in a
  file specifically about persisted documents — the worst possible place.
- Rule 2 flagged a `BACKLOG.md` line that recorded the handle rename by spelling the old handle.
  Widening rule 2 to allow the old handle's spelling would stop it catching a genuinely reintroduced
  handle. The doc lost the spelling instead; `6767b90` records it.

### Traps when editing guarded docs

- **You cannot quote the guard's injected test strings verbatim** in a non-exempt file.
  `docs/BACKLOG.md` is not exempt, so a document describing the guard's own falsification trips the
  guard. Describe the injections instead. There is a note to that effect in the backlog entry.
- Reflowing a licensing paragraph can orphan a fragment — a bare parenthesised licence URL on its
  own line, for instance — with no licensing phrase near it. Keep the DPCGL phrases whole.
- **An untracked file is invisible to the guard.** Its scope is `git ls-files`, so a new file sits in
  the working tree unchecked, and a green run says nothing about it. This document proved the point:
  its first guard run passed 6/6 only because it was untracked, and staging it turned up six
  violations immediately. `git add` a new doc *before* trusting a green run on it.

### Attribution that must survive, wherever you edit

`docs/CONTEXT.md:25-29` is now **the only place** the 2.0 wording lives (the per-source READMEs went
with `tools/srd-sources/`). Both the 2.0 and 1.0 notices are separate obligations. The trademark
disclaimer must stay contiguous on one line — a rewrite once split the rights holder's name from its
"LLC" across a line break, and the guard's own survival assertion caught it.

---

## 5. Mistakes from this session, so they are not repeated

- **Measure counts, never reason them** (`BACKLOG.md:516`). Reasoned counts were wrong about twelve
  times this session; measured counts, zero. Examples: `dh-` sites were 62 not 50; e2e locators 6
  not 4; storage prefixes 3 not 1; `legacy/` marks 20 not 8. The backlog's own entry was wrong by
  the same failure.
- **A blind substitution inverted two sentences.** Renaming the retired product to Tactical Engine
  produced "Tactical Engine retired" in `BACKLOG.md` and in the content-pack spec's §9, where the
  trailing clause was the reason the *old* name had to go. The pass asserted against doubling but not
  against semantic inversion. If you run another name substitution, audit for the new name sitting
  beside `retired`, `former`, `legacy`, `superseded`.
- **"155 dead citations" was an overcount.** Most were the deletion's own changelog — sentences
  naming a deleted path *in order to record that it was deleted*. The real figure is **28 dead paths
  + 13 dead symbols**. Distinguish records from dangling pointers before scoping.
- **`e165b60`'s message claims `legacy/` was out of scope.** It cited `CLAUDE.md` and `AGENTS.md`
  correctly but missed the owner's amendment in `BACKLOG.md`, which `CLAUDE.md` itself says to read
  second. `b5ce271` corrects it.
- **All asserts before any write** (`BACKLOG.md:509`). This caught four bad patches this session
  before anything hit disk. It is worth the cost every time.

---

## 6. What to do next, ranked

### 1. Make packs importable — the owner's stated requirement, currently unmet

The framing was: *"anything that had ip should be importable and not lost — think of the engine as
the base that could import [the licensed] IP if we had the rights after"*, and *"when being able to
import i want to be able to import cards and customise cards"*.

Right now the catalogue is **preserved but unreachable**. `packs/srd.json` and
`packs/srd-abilities.json` exist (gitignored, written by the since-deleted `tools/export-pack.ts`,
retrievable from history) and **nothing in the app reads a pack from disk**. Until that exists, the
IP was removed with no way to bring it back.

Known starting points, and what was *not* yet verified when this session stopped:

- `src/engine/content/pack/schema.ts` — `contentPackSchema` over seven content types.
  **It has no `conditions` field**, but `packs/srd-abilities.json` carries 54 conditions. Reconcile.
- `src/engine/content/pack/import.ts` — `importContentPack` turns raw shapes into typed content and
  returns `ImportResult` with `ContentIssue[]`. Importers never throw.
- `src/main.ts:749` — `projectSchema.safeParse(migrateDocument(JSON.parse(text)))` is how a project
  file comes in from disk. A pack may be able to ride the same door; **this was not checked**.
- Still to inspect: the actual top-level keys of both `packs/*.json`, who calls `importContentPack`
  today, and whether there is a UI entry point (Project ▾) to hang "import pack" on.
- Note the exporter coerced 18 Minion blocks' `Infinity` thresholds to `999`, per
  `contentPackSchema`'s own instruction. A reader must not treat that as a real number.

### 2. Cards as the unit (`BACKLOG.md` §3) — the owner's design direction

*"things should be centered around cards — not just domain cards but any features should be seen as
cards and interacted with like cards in the game, like a TCG."*

The spec is written and decided; nothing is built. It is designed to ride slice 4's migration rather
than pay for a second one — so the longer it waits, the more likely it needs its own migration.

- The six `abilitySourceSchema` kinds collapse toward **one**: the card the ability sits on. How the
  card got into play becomes a `grant` field.
- `featureSchema` stops being a content type; a class's features become a list of card ids. This
  kills the name-matching that currently pairs a printed feature with its ability.
- The pack's `domainCards` becomes `cards`.

### 3. The dead-reference doc rewrite

28 dead paths and 13 dead symbols, concentrated in `docs/DEVELOPING.md` (10) and
`docs/developer-guide.html` (10), then `MANUAL.md` (5) and `CRPG-GAPS.md` (3). These actively
mislead: `DEVELOPING.md:120-123` tables four deleted modules *with line counts*, `:183` lists a
deleted test among "the six tests" (there are nine unit files and eleven e2e specs), `:189-191` says
`tools/` holds two Python scripts plus the vendored tree (it holds `build-public-assets.ts` and
`index-card-art.mjs`), and `:475-490`, `:577`, `:591`, `:596` give recipes telling the next person to
edit files that do not exist. `CRPG-GAPS.md:147-188` still describes the 189-card / 417-feature
catalogue as shipped.

`docs/CONTEXT.md:55-67` is the one place already correct and is the template for the rest.

### 4. The deliberate red test

`demo-defense.test.ts`'s Stress assertion. Left red on purpose rather than guessed at. Either fix it
with an understanding of why the number differs, or delete it with a reason — but do not adjust the
expected value to match the output.

---

## 7. Working rules worth re-reading before you start

All in `docs/BACKLOG.md` §4, learned expensively:

- **§484 Use a Python patch script, not the shell.** A heredoc carrying a *script* has failed here
  more than once and `python -` hangs. Write the script to a scratchpad with the Write tool, then
  `python <path>`. A heredoc carrying *prose* is fine — `git commit -F -` is the normal path.
- **`newline=''` is not optional.** The repo is `eol=lf`; Python's default text mode on Windows
  rewrites every `\n` on the way out. Note `.gitattributes` also sets `*.bat text eol=crlf`, and git
  stores LF in the blob regardless — a warning about `legacy/start.bat` is benign.
- **§509 Every assert before every write**, across all files a patch touches.
- **§574 The e2e suite hand-mirrors the driver type.** `src/main.ts:132` declares
  `window.__engine` and `tests/e2e/demo.spec.ts:14` hand-writes its own copy. Update both.
- **§603 Before claiming done:** `tsc`, `vitest` **and** `playwright`. Every time.
- **§620** Every commit body carries a verification line, plus a sentence on how new tests were
  shown to fail without their fix.

The scratchpad patch scripts from this session do **not** travel with the repo. They are all
reconstructible from the commits; the protocol above is what matters.
