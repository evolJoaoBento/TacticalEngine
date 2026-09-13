# Tactical Engine — Backlog and agent startup notes

For whoever picks this up next. `docs/DEVELOPING.md` says how to extend the engine and
`docs/CRPG-GAPS.md` audits what exists; this file says **what to build next** and carries the
handful of working rules that are learned the expensive way rather than read.

**Pinned to commit `01b4c83`.** At that commit: `npx tsc --noEmit` clean, **1834 of 1835 unit tests
passing across 92 files**. The single failure is the documented deliberate one in
`demo-defense.test.ts` — a Stress assertion left red after four attempts rather than guessed at, with
what was ruled out recorded in its commit. **Playwright is green: 103 passed, 3.6 minutes, `EXIT 0`** — a full run, not a tally of targeted
ones. All 21 failures are fixed. What follows is the diagnosis of the red run that found them, kept
because the cause and the tiering are the reusable parts.

Read the duration as a signal: green is ~3.6 minutes, and the red runs took 15 because twenty-one
failing locators each waited out a 90-second timeout.

The run was **RED: 21 failed, 82 passed**, measured
twice after the demo was repointed (15.1m and 15.3m, identical counts). An earlier version of this
line called that green by reading the pass count and not the exit code.

**All 21 are one cause: the specs name vendored content, the shipped pack names its own.** `7769fa1`
and the five commits after it changed what the demo plays, and no commit since has touched
`tests/e2e/`, so the repoint landed without its e2e half. An earlier version of this file guessed
three or four causes from the shape of the test names; both places where it could have gone the other
way were checked and did not:

* `card-browser` is not art-tier fallout. It injects `setCards('kara', ['bare-bones', …])` — six
  vendored ids — so `.deck-slot` resolving to 0 is the correct behaviour of a pack without them.
* `placement` / `editor-shell` are not construction fallout. `main.ts` hands the editor
  `adversaries: ADVERSARY_DEFS`, which looks like a second list but is
  `[...DEMO_ADVERSARIES.values()]`, and `DEMO_ADVERSARIES = STARTER_ADVERSARIES`. So
  `library-search.fill('wolf')` matches nothing, `[data-item]` never appears, and the click waits
  out its 90 seconds.

**Tier A — done: all fourteen re-pinned onto shipped content and verified in a browser.**
Kept as a table because it says which spec was pointed at what, which is what anybody repeating
this against another pack will want.

| Spec | Stale | Shipped |
|---|---|---|
| `demo:1479` | `Broadsword · Chainmail`, item `full-plate` | `Longsword · Ringmail`, `padded-coat` |
| `demo:2120` | `adversary: 'acid-burrower'` | `bandit-archer` |
| `demo:2293` | `gambeson-armor`, card `whirlwind` | `padded-coat`, `shield-wall` |
| `demo:2387` | `chainmail-armor` | `ringmail` |
| `demo:1890` | six vendored ids, log `/Acid Burrower's/` | 5 bulwark + `smoke-step`, `Hollow Knight's` |
| `card-browser` ×4 | `bare-bones`, `not-good-enough`, `reckless`, … | starter ids; Domain `blade`→`bulwark`, count 3→5 |
| `placement` ×3, `editor-shell` | search `wolf`, `tangle-bramble` | search `hound` (Rot Hound, unique) |
| `between-fights:141` | `/plate/i` in the payout | the table pays gold, draught, carapace, longsword, round shield |

Two of these are rewrites rather than swaps. `demo:1479` equips `longsword` expecting the displaced
`broadsword` to land in the pack — but Kara's primary *is* the longsword now, so the equip is a no-op
and `[data-item="broadsword"]` can never appear; it needs a different weapon to find (`hunting-bow`).
`card-browser` asserts counts per domain, and the starter domains hold 5 each where the vendored ones
held 3.

**Tier B — done: four cards stopped being text only, and the seven specs read them.** It needed
content, not engine work, exactly as this entry predicted. `warding-flame` got the zone its text
describes, `cinder-burst` became the first shipped card aimed at the ground (`target.kind: 'point'`
with `around: 'point'` on the roll), `shield-wall` got a named ally and a condition carrying the
bonus, and the sentinel's printed signature `Hold the Line` became mechanical — both conditions it
needs already existed. Two of the five the file called unsayable were sayable all along: a timed
bonus to someone else is a condition with a duration.

Three rewrites dropped an assertion each, and each drop was a correction rather than a concession:
`shield-wall` carries no check so a `check-prompt` could never appear; `cinder-burst` moves nobody
so the caster-runs-the-line assertion left with Deathrun; and `demo:1819`'s Hope-cost assertion
contradicted the pack's rule of spending no Hope. One silent guard became an assertion and fired
immediately — `if (targets.length > 1)` had been skipping a whole arm-and-disarm path whenever one
husk stood adjacent, which is the fifth vacuous pass found this way.

**What this uncovered and did not fix.** `contentPackSchema` has no `conditions` field: a project
*document* carries `conditionDefs` and `worldOptions` merges them, but a content *pack* cannot. So a
card that applies a zone condition cannot be imported with the condition it depends on — and a zone
whose condition is missing is silent *and* writes the condition's id into the log, because
`conditionName` falls back to it. Closing that is the next slice for mechanics travelling on cards.
Smaller: `cut-purse-strings`, `rallying-cry` and `smoke-step` are still text only, and only the
first has a real blocker (`addItem` names a bare item id with no source, so taking what somebody
else carries cannot be said); and `holding-the-line`/`caught-in-the-line` still sit in
`content/conditions.ts`, which slice 3 prunes, when they belong beside the feature that arms them.

The old diagnosis, kept because the reasoning is the reusable part: the pack shipped 14 abilities —
eleven passives and three `action`s with no effects. These specs exercise the *interactive* paths — arming, a
ground aim, Escape-disarm, an Experience prompt, a zone, a condition — and none can be renamed onto
content that does nothing. It is content work, not engine work: the effect vocabulary already has
`push`, `zone`, `applyCondition`, `check` with `difficulty: 'target'`, `damage`, `move` and
`vaultCard`, and the SRD originals are templates to write against rather than copy.

| Spec | Wants | Write |
|---|---|---|
| `demo:1819` | a Hope cost, a check, an Experience pick, a named target | an ember action with a `check` |
| `demo:1856` | arm, pick a target, Escape-disarm, push | a bulwark/ember card with `push` |
| `demo:2436` | a ground aim with `shape()`, `lit()`, and the caster moving | a card aimed at ground |
| `playpass:134` | a named zone with tiles, damage, a floater, a flinch | `cinder-burst` as a real zone |
| `playpass:204` | conditions `holding-the-line` / `caught-in-the-line` | a bulwark card with `zone` + `applyCondition` |
| `readout` ×2 | cards that leave a condition behind | falls out of the two above |

The five cards the pack itself admits ship as text only — `shield-wall`, `rallying-cry`, `smoke-step`,
`cut-purse-strings`, `cinder-burst` — are where these belong, so Tier B is the same work as **making
mechanics carry on cards**, not a detour from it. `holding-the-line` and `caught-in-the-line` are safe
ids to keep: the starter sentinel already ships a signature feature named Hold the Line, so the name
is the pack's own. `korvax-circle` is not, and wants a neutral id.

If the passing count comes back lower than 1834, something was lost — check before building on it. Symbol names are
the stable handles here; line numbers move.

---

## The two threads

Everything ranked below serves one of two goals, and they are not independent.

**1. Remove the Daggerheart DNA.** The project carries no Daggerheart IP going forward. Usable
(uncopyrightable) mechanics stay: dual-dice resolution, damage thresholds, armour slots, a stress
pool, the initiative-free loop, card-slot loadouts, advantage, experiences. What goes is everything
expressive — names, the nine-domain catalogue and its card set, verbatim rules text, adversary
names and their printed prose, UI labels lifted from the book. The rule from the legal note:
**ship an original set, and let people import their own.**

**2. Make mechanics importable as cards.** The engine is the base; anything content-bearing is a
pack. And the unit of content is a **card** — not only domain cards, but any feature a character or
creature has. Importing means importing cards; customising means customising cards.

The two specs:

| Spec | Status |
|---|---|
| `docs/superpowers/specs/2026-09-12-generic-engine-content-packs-design.md` | 4 slices. 1 and 2 done. 3 is destructive and next. |
| `docs/superpowers/specs/2026-09-12-cards-as-the-unit-design.md` | Decided 2026-09-12. Not built. Rides slice 4's migration. |

Read both before adding anything that names a source or defines a feature.

---

## 1. Reading order

Do not read the sources first. Forty minutes of reading below saves a day.

| Order | File | Why |
|---|---|---|
| 1 | `docs/CONTEXT.md` | The goal, the hard constraints, the stack. The working agreement. |
| 2 | **this file** | What to build, and the rules that are not written anywhere else. |
| 3 | the two specs above | What "generic" and "cards as the unit" actually mean, including what they rule out. |
| 4 | `docs/DEVELOPING.md` | Extending the engine: layer map, invariants, recipes, gotchas. A reference, not a tutorial. **§11 Gotchas earns its reading twice.** |
| 5 | `docs/CRPG-GAPS.md` | The honest audit against the CRPG goal. Read the relevant section before claiming a system exists or is missing. |
| 6 | `.claude/skills/run-the-demo/SKILL.md` | Driving the app in a real browser. Read it before writing any Playwright of your own. |

`docs/MANUAL.md` is user-facing: playing the demo and authoring content, every panel and field.
`docs/ADVERSARIES.md` and `docs/CARDS.md` are **generated from the vendored catalogue and are deleted
by slice 3** along with their generators — do not hand-edit them, and do not build anything that
reads them. `docs/research/legacy-*.md` are static-analysis notes on the prototype with `file:line`
anchors; read those instead of re-reading `legacy/`.

---

## 2. The backlog, ranked

The ranking is the two threads, in dependency order. The editor rebuild — the user's direction of
2026-09-10 — is **below** them now: it was ahead of a fight-first ranking, not ahead of removing the
IP, and slice 3 touches content the editor panels read.

A *slice* is one behaviour complete: rule, content, editor field, validation, tests, docs. Half a
slice gets finished by someone with less context.

**Keeping this list true is part of landing a slice.** When one lands, delete its item here, record
it in the matching `CRPG-GAPS.md` section as done, and re-pin the commit and suite numbers in the
header. A backlog nobody prunes is wrong within a week, and then it costs the next agent the startup
time it was written to save.

### 0. ~~Finish the fixture conversion~~ — **done**, and slice 3 is unblocked

Every **game-layer** test now carries its own content instead of borrowing the catalogue's.
`authored-scenario.test.ts` 49 → 0, `demo-abilities.test.ts` 14 → 0, `demo-cards.test.ts` 14 → 0,
and the earlier `demo-defense.test.ts` conversion.

**The precondition is not met yet, and an earlier version of this file wrongly said it was.**
Nine more test files read the vendored folder off disk at runtime and fail the moment it goes.
They are engine-layer tests using the catalogue as a content fixture, which is why a game-layer
sweep never touched them:

| File | What it wants |
|---|---|
| `editor/item-edits.test.ts` | a weapon id |
| `editor/party-edits.test.ts` | a class, subclass, ancestry, armour, weapon, two cards |
| `engine/character/progression.test.ts` | the same, plus a subclass's domains and a card's recall cost |
| `engine/character/sheet.test.ts` | a class, armour, weapon |
| `engine/content/abilities.test.ts` | a class, subclass, two cards |
| `engine/script/abilities.test.ts` | a class, subclass, armour, weapon, two cards |
| `engine/combat/adversary-features.test.ts` | one stat block — and only to parse brackets |
| `engine/content/srd/library.test.ts` | the whole catalogue; **dies with the slice** |
| `tests/unit/demo-map-fight.test.ts` | one stat block |

Six share one `read()` helper over the seven daggersearch JSONs, so the conversion is one
repeated move rather than nine problems: point it at `STARTER_PACK` and re-pin the names.
Every name has a starter substitute — `guardian`→`sentinel`, `stalwart`→`shieldbearer`,
`chainmail-armor`→`ringmail`, `gambeson-armor`→`padded-coat`, `broadsword`→`longsword`,
`bare-bones`/`get-back-up`→`power-slash`/`iron-stance`, `human` unchanged. Two assertions need
more than a rename: a subclass's domains (`['valor','blade']` → `['bulwark']`) and a card's
recall cost. The two adversary tests want a fixture stat block; `adversary-features` only ever
asserts bracket parsing, so inline literals suit it better than any catalogue.

Roughly forty specimens live in `tests/fixtures/cards.ts` and `tests/fixtures/adversary-features.ts`,
named for the mechanism rather than anything they were read off, so one serves several tests. They
are also an unplanned proof that importing works: each pushes content into a project and plays it,
which is exactly what an imported pack does.

Two findings from that work worth keeping:

- **`loadoutDomain` reads the merged content.** It counts `character.cards` filtered by
  `card.domain`, and those cards come from `deriveCharacter(sheet, characterContentFor(project), …)`.
  So a project's own cards satisfy a `{ kind: 'loadout', domain, op, value }` gate exactly as shipped
  cards do — which is what any content author needs to know, and what made three tests fixable.
- **A weapon swing is a roll with the weapon's trait**, passed at the attack site as
  `rollingOffers(…, profile.trait)`. A card gated on traits no equipped weapon rolls can never be
  offered, however many seeds are tried.

### 1. Slice 3 — export and purge (destructive, on a branch)

The only destructive slice. It runs after item 0, on a branch, and everything it deletes survives in
git history and in the exported pack.

1. Export today's catalogue to gitignored `packs/`.
2. Cut the eight imports that point at the vendored sources.
3. Delete `tools/srd-sources/`, the SRD catalogues, the generated `ADVERSARIES.md` / `CARDS.md`, and
   their generators.

**What the folder actually holds, listed rather than assumed:** `abilities.ts` (182 KB),
`adversary-abilities.ts` (162 KB), `hooks.ts`, `seansbox-adversaries.ts`, and two test files. Ten
files under `src/` import from it, not the spec's eight.

**`hooks.ts` is engine-native and misfiled. Move it, do not delete it** — `hooksFor` returns
`SRD_HOOKS` as the base every project merges over, so deleting it takes working rules out with the
content.

**`conditions.ts` is not in that folder at all.** It lives at `src/engine/content/conditions.ts`,
outside anything slice 3 sweeps, so there is nothing to move. It needs *pruning* instead: the
card-specific markers inside it (`sigiled`, `tolled`, `broken`, `glyphed`, `enraptured` — names only
a departing card reads) go with those cards, while the engine's own conditions, which its own rules
read through `withSrdConditions`, stay. Nine files read it; check each before cutting an entry.

**Two test files in the folder test the departing catalogue and are deleted, not converted:**
`library.test.ts` sweeps the whole SRD library through the runner, and `seansbox-adversaries.test.ts`
tests an importer for one vendored source. Item 0's count deliberately excludes them — converting a
test whose subject is about to be deleted is wasted work.

**`tools/srd-sources/` is three sources, not one:** `official-2.0`, `daggersearch`, `seansbox`,
2.1 MB together. `seansbox-adversaries.ts` is the importer for the third and goes with it.

**`.gitignore` has no `packs` entry yet.** The spec calls the export target "gitignored `packs/`";
adding that rule is a step of this slice, not a precondition somebody already did.

*Done means:* no tracked file names a source, the app boots on the starter pack alone, and `tsc`,
`vitest` and `playwright` are green.

### 2. Slice 4 — renames, migration, and the guard

- **Light and Shadow.** `hope` → `light`, `fear` → `shadow`, across 71 files. This is a **document
  format change**, not a rename: `poolNameSchema`, the pool selector enum, four
  `checkRequestSchema` keys (`onSuccessWithHope` and its three siblings are real persisted keys),
  four `RollOutcome` values, the UI labels in `DiceTray` and `PartyHud`, and the `hope`/`fear` test
  ids those pips carry — which the e2e selectors read.
- **`formatVersion` 1 → 2**, with a load-time migration that rewrites a version-1 document rather
  than rejecting it. **Exercised on a real version-1 fixture**, or it is a promise rather than a
  behaviour.
- **Identity.** `package.json` name → `tactical-engine`, product name **Tactical Engine**, PolyHeart
  retired, applied across the editor title, docs, `CLAUDE.md` and `AGENTS.md`.
- **`legacy/` prose.** The never-modify rule is amended by the owner's ruling: all eight marks there
  are cosmetic comments and one editor hint, none functional. A prose rewrite cannot break the demo.
- **The guard.** Extend `tests/unit/licensing-boundary.test.ts` to fail on the marks in any tracked
  file, any path under `tools/srd-sources/`, the retired product name, and the paired terms as
  identifiers. The boundary becomes enforced rather than remembered — the same reason the card-art
  rule is a test rather than a note.

### 3. Cards as the unit

The spec is written and decided; nothing is built. It rides slice 4's migration rather than paying
for a second one.

- The six `abilitySourceSchema` kinds collapse toward **one**: the card the ability sits on. What
  differs is *how the card got into play*, which becomes a `grant` field on the card rather than a
  variant of the source.
- `featureSchema` stops being a content type; a class's features become a list of card ids. This
  kills the **name-matching** that currently pairs a printed feature with its ability — rename the
  ability today and the text silently stops being found.
- `kind: 'action' | 'reaction' | 'passive'` already exists and is exactly the passive/active split
  the decision names. Nothing new is needed there.
- The pack format's `domainCards` becomes `cards`.
- **Zones** are the part that needs designing: *chosen* cards are bound by `LOADOUT_LIMIT`, *granted*
  cards are not. The behaviour already exists — `loadoutOf` reads `sheet.loadout`, `abilitiesFor`
  folds class and subclass abilities in regardless — so what is missing is saying so **on the card**
  instead of inferring it from a source kind.
- Four open questions are recorded in the spec's §6 with recommendations, none settled. The one that
  shapes the schema: **a card points at its abilities by id, not inline** — one card routinely
  carries four (a sigil that marks, two halves that bank a token, one that spends them), and
  inlining would break every reaction that has to be found by trigger.

**Not a licence to rebuild the catalogue with a card model instead of a list.** The IP constraints
are untouched by this.

### 4. The pack surface: choosing one, and editing cards

The *mechanism* already exists — the spec is explicit that packs load through the existing project
load path, and no new runtime is invented. `projectSchema` carries the seven content fields,
`mergePack` lays a project's lists over the pack's by id (project wins, base survives), and the
test fixtures are a working demonstration: ~40 specimens across three files push content into a
project and play it, which is exactly what an import does.

What is missing is the surface:

- a picker that reads a pack file, validates it, and hands it to that path;
- the editor panels that today edit a class's feature text editing **cards** instead — which is what
  "customise cards" means;
- card zones in the renderer, and playing from them. New UI, not a rename.

Judge this after item 3: editing cards before the card model collapses means editing it twice.

### 5. The editor rebuild

The user's direction of 2026-09-10, in five parts, each with its own spec, plan and slices:
Shell + Inspector; 3D multi-level world; TaleSpire-style terrain; combat with factions; interaction
graphs. Part 1's spec is `docs/superpowers/specs/2026-09-10-editor-shell-design.md` and its §15
records the rulings (C1–C9) that landed the construction layer. Part 2 starts from
`docs/research/construction-layer-review.md` and `docs/research/multilevel-dependency-map.md`.

**Done:** part 1 slice 1 (the shell's frame); sparse construction with stackable tiles, extended
coordinates, brush/rotation/level controls, undo/save and chunked LOD; placement rotation with a
fisheye Z ladder (`src/editor/height-ladder.ts`); creature models chosen from Combat's panel, per
type or per placed creature; and rigged-model import carrying the `.glb` inside the project with
scale, seating, facing and four animation clips.

**Next:** part 2 — one vertical unit and multilevel navigation over constructed surfaces, spec
first; part 1 slice 2's remaining edit-view items (objects, spawns, trigger cells) and a rotated
prop-facing ghost during Alt.

### 6. Starter-pack depth

The old item here counted the vendored catalogue's unscripted remainder — 47 text-only cards, 292
narrated adversary features. **That item dies with slice 3**, and so do the generated docs that kept
the count honest.

What replaces it: the starter pack is sized to keep the game-layer tests meaningful, not to be a
game — 3 classes, generic ancestries, ~15 cards, ~10 adversaries. Depth beyond that is a content
slice, judged on what it adds to a fight. `DEVELOPING.md` §7(c) is still the recipe for scripting a
feature.

### 7. Movement Under Pressure — the rule is written and nothing calls it

`moveUnderPressure` in `engine/combat/area.ts` implements the repositioning rule and `area.test.ts`
pins it. **It has zero callers in `src/game/`.** The demo instead clamps a fighting walk to
`combatReach` and logs "*<name> can go no further this turn.*"

*Done means:* `moveSelectedTo` offers the Agility Roll when a click lands past Close in a fight
rather than silently walking as far as it can — the refusal becomes a prompt with a roll behind it,
answered through the same `pending` channel as a script's check. The adversary side reads the same
function so the GM's turn stops inventing its own budget.

### 8. Materials for imported models

`CRPG-GAPS.md` §9. Textures arrive with a glTF file, but nothing authors materials: there is no way
to tint one, swap a texture, or override what the file ships with. The file picker that was the other
half of this item landed on 2026-09-12.

### 9. Extend measured rendering budgets beyond construction

Construction has chunk instancing, frustum/distance culling, three LODs and a tested residency
budget (`render/building-view.ts`). Extend those to the legacy height field and props. Large
populated worlds still need hardware FPS/memory profiling; geometry counters are available through
`window.__polyheart.buildingStats()` — a handle whose name changes with the identity rename.

### 10. Zip project export

`fflate` is a dependency and is imported nowhere under `src/`. `CONTEXT.md`'s "zip import and export
of projects with assets" is not implemented — export is `JSON.stringify` into a `Blob`, so a project
with imported assets cannot be handed to anyone as one file. This matters more once packs are a
product: a pack with art is the same problem.

---

## 3. Known doc drift

`DEVELOPING.md` labels its old line anchors as historical; use symbol names to find current
implementations.

Slice 3 invalidates documentation, not only code. `ADVERSARIES.md` and `CARDS.md` go with their
generators. `CONTEXT.md` still describes the SRD sourcing as the working agreement and needs the
same treatment as the backlog header. Anything quoting a count of catalogue content is stale the
moment the catalogue is exported.

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

### Every assert runs before every write

Not only within one file — across **all** files a patch touches. A script that writes its first file
and then trips an assertion on its second leaves a half-applied tree and needs a third script to
finish. That happened three times before the ordering was enforced and has not happened since. With
the asserts first, a tripped guard costs a read and nothing else.

### Measure counts, never reason them

In one long conversion, **seven** occurrence counts set by reasoning were wrong and **zero** counts
set by measurement were. Grep the count, then write the assertion from what came back. The same
applies to "this string appears once" intuitions: the same card id wore five different shapes in one
file — a held-card literal, three `useAbility` spellings with different scene variables, and one
element of a multi-card hand belonging to a test the patch did not convert.

And mind the **stage** a count is asserted at: a file-wide grep found six mentions of one id, but two
were call sites an earlier substitution in the same script rewrote, so the correct expectation at the
later pass was four.

### Scope a straggler assert to what the patch claims

An assertion that some departing name appears nowhere in the file is a false alarm when the patch
converts one block. It fired **seven** times on text the patch never touched: test titles, seed
strings, and blocks scheduled for a later slice. Slice the block out, substitute inside it, splice it
back, and assert on that substring.

**Seed strings and test titles carry ids.** A seed is fed to the RNG, so renaming one changes the
rolls and re-rolls any seed-hunting loop. Rename a seed only when it names something proprietary;
when it is an ordinary word, narrow the guard instead.

### A green test can pass for the wrong reason

The expensive class of defect in this work was not red tests but **vacuous** ones. Four examples, all
found by reading rather than by running:

- a "control run" that suppressed nothing, because the override it relied on only ever suppressed
  shipped content — and with a fixture there was nothing to suppress, so both arms were identical;
- a "not offered" assertion that held because the card did not exist at all;
- `useAbility` answering `'missing'` for an unknown id, which **satisfies**
  `expect(...).not.toBe('refused')`;
- a comment claiming a roll used "the block's own Difficulty" when the effect takes a literal and
  cannot read one — the two numbers merely happened to match.

Before trusting a passing assertion about absence, check that the thing whose absence is asserted
*could* have been present.

### `vitest` transpiles without type-checking

A test suite can be green on code `tsc` rejects. `const fixture-lurker = ...` — a hyphen produced by
a blanket rename — ran fine under vitest and failed the build. **Green tests over a red build is not
a pass.** `npx tsc --noEmit` is the only static check in the repo.

### Check who writes a string before rewriting it

Half the strings a test asserts are written by the **engine** out of content's own names —
`${name} uses ${ability.name}`, `${who} turns aside ${n} of it.`, `${who} marks the ground where they
stand.` Those re-pin by themselves when content is renamed, and rewriting them breaks the test for a
reason that looks like a rules bug. The other half is content prose, which must be rewritten. One
grep settles which, and guessing cost real time twice.

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
suite is the only thing that catches a broken boot. **A green run is about 3.6 minutes** (103 tests),
so there is no reason to skip it.

A RED run takes far longer -- the two runs that found the repoint's damage took 15.1 and 15.3 minutes,
because a failing locator waits out a 90-second timeout and twenty-one of them is most of that
difference. So a slow run is itself a signal, and a long one is not evidence the suite is expensive.
An earlier version of this file turned that timeout cost into the suite's runtime and told you to
expect fifteen minutes.

**Read the exit code, not the pass count.** Playwright prints `82 passed (15.1m)` as its last
line and the failure count *above* it, so a red run's final line looks like a green one. `EXIT 1`,
or `test-results/.last-run.json` reading `"status": "failed"`, is the verdict. An earlier version of
this file claimed the suite was green on the strength of that pass line; it was red both times it
ran. The same mistake put a false slice-3 precondition here. Read to the end of the output. Every commit
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

**Report at the length the reader asked for.** A long technical narration of every probe and
correction is honest and still wrong if the person reading it cannot find the answer in it. State
what changed, what it cost, and what is next; keep the working out for the commit body.
