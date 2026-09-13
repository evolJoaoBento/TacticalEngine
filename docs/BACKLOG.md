# Tactical Engine — Backlog and agent startup notes

For whoever picks this up next. `docs/DEVELOPING.md` says how to extend the engine and
`docs/CRPG-GAPS.md` audits what exists; this file says **what to build next** and carries the
handful of working rules that are learned the expensive way rather than read.

## The grant pickers, in a browser — done

The Cards panel's subclass-stage, ancestry and community pickers had only unit tests behind them
(the class picker was already in *The card editor*'s e2e). One e2e now writes a card, grants it by
each in turn and reads each grant out of the project, then plays: Kara is a Wayfarer, and the card
granted by the Wayfarer community is in her loadout's **Always in play**.

`npx tsc --noEmit` clean; vitest **1850 passed (1850), run with the next slice applied on top**; Playwright **109 passed (4.0m), run with the next slice applied on top**, `EXIT 0`.

## Export pack — done

**Project ▾ → Export pack** writes the project's content as a pack file, `<project id>-pack.json`:
every list a pack carries (`packOf`, `content/pack/document.ts`) -- classes, ancestries,
communities, subclasses, cards, weapons, armor, adversaries, the abilities on the cards and the
conditions they apply -- copied out under the current `formatVersion`, and none of the scenes, party
or code. It is the other half of Import pack: a test writes the starter pack out and reads it back
through `readPack` entry for entry, nothing refused and nothing skipped, and the e2e checks the
downloaded file against the project list for list.

`npx tsc --noEmit` clean; vitest **1849 passed (1849)**; Playwright **108 passed (3.9m)**, `EXIT 0`. Three breaks -- a list
left out, the file sharing the project's entries, the menu item doing nothing -- each fail the test
written for them.

## Text-only cards in the Cards panel — done

The Cards panel lists every card no ability sits on under **Text only** (`unscriptedCards`,
`editor/card-list.ts`), read from the pack's cards with the project's own laid over them as they
stand. In the starter pack that is twenty-two of its thirty-nine cards: three a character chooses
(`rallying-cry`, `smoke-step`, `cut-purse-strings`) and nineteen features a class, subclass, ancestry
or community prints as text. The count this file and the manual gave before was three -- the chosen
ones only; the new test found the rest. One opens on its own: the card's name and text (the
project's own card edited where it stands, a pack's read-only until **Edit a copy**), how it gets
into play, and **+ Script**, which writes the first ability on it, named for the card
(`scriptIdFor`), and moves it up into the list of abilities.

`npx tsc --noEmit` clean; vitest **1848 passed (1848)**; Playwright **107 passed (3.9m)**, `EXIT 0`. Three breaks -- the list
keeping scripted cards, the list reading the snapshot rather than the project, **+ Script** writing
nothing -- each fail the test written for them.

## A roll pays out when it is made — done

A party swing's Light, the GM's Shadow and a critical's cleared Stress now arrive with the roll,
before anything answers the damage roll, rather than when the blow lands. `applyRoll`
(`combat/attack.ts`) is that half of `applyAttack` on its own. `afterRolled` settles it, where
nothing can change the Duality Dice any more -- every card that rerolls, names or raises them answers
`partyRolling`, earlier -- and marks the swing `settled`, so `landPartyAttack` lands only the blow
(`applyAttack(state, outcome, { roll: false })`). A blaze of glory never stops between the two and
still pays both at once; the runner's own `attack` and `check` already settled the roll before their
effects ran.

So from 0 Stress, a card that marks one on a critical's damage roll costs its Stress, and a card that
costs a Light can spend the Light the same roll gave. A test says each, from nothing held; the lift
test keeps its one Stress marked and measures only the lift.

`npx tsc --noEmit` clean; vitest **1846 passed (1846)**; Playwright **106 passed (3.8m)**, `EXIT 0`. Three breaks -- the swing
paying out only when it lands, the landing paying out again, `roll: false` ignored -- each fail the
tests written for them.

## The card editor — done

The Cards panel reaches the cards it could only name before. **a loadout** is a grant like the
others: switching a card into one writes the four numbers a chosen card cannot load without -- a
domain some class opens, a type, a level, a recall cost -- and a card switched out keeps them. A card
the pack prints is shown as the pack has it beside
**Edit a copy** (`addCard`): the copy lays over the pack's by id, whole (`mergePack`), so the table
plays it and the pack is never written. **Check** warns about a chosen card in a domain no class
opens, held or not -- the party's own warning covers a held card outside its holder's domains -- and
about one past level 10. The e2e copies Power Slash, grants it to a class and back, sets its recall
to 3, and finds 3 on Kara's loadout.

**Still open:** the only way back to the pack's card is Undo: ✕ on the ability leaves the copy,
still played. A card with no ability on it, and a card's own name and text, were open here too;
*Text-only cards in the Cards panel*, above, reaches them.

`npx tsc --noEmit` clean; vitest **1843 passed (1843)**; Playwright **106 passed (3.7m)**, `EXIT 0`. Four breaks -- a loadout
written without its numbers, the project's cards laid over nothing, no warning for an unopened
domain, a second copy counted as an edit -- each fail the test written for them.

## The lift's red test — resolved

The one failure every run since `f4df9fa` carried was the test, not the card. It read whether the
swing was a critical off `demo.rolls` before the reaction was answered, and a party swing's roll
only reaches `demo.rolls` when the blow lands, so it read the swing before and said *not a critical*
every time. On seed `lifted-6` the swing is a critical: letting it pass ends at 0 Stress, playing
the card ends at 0 as well, and the formula expected 1.

Fixed on the test's own subject. Kara starts the swing with one Stress marked, so a critical's clear
has one to take in both runs, and the card costs exactly one more than letting the blow pass: the
critical drops out of the arithmetic. Three breaks -- the lift worth nothing, the card costing
nothing, no Stress marked before the swing -- each turn it red again.

**Open when this was written, and fixed since (*A roll pays out when it is made*, above): when a
critical clears its Stress.** The engine cleared it when the
blow landed (`applyAttack`, `combat/attack.ts`), after anything that answered the damage roll. The
SRD's order is the roll first -- the critical clears a Stress -- then the damage roll, then "mark
a Stress" on it. From 0 Stress the two disagree: the SRD ends at 1, the engine pays the card's
Stress and the landing clear takes it back, so the card is free. The same deferral holds the roll's
Light, so a Light-cost card answering the damage roll cannot spend the Light that roll just gave.
The fix is settling the roll's own economy in `afterRolled` (demo-scene.ts), where nothing can
change the Duality dice any more -- every card that rerolls, names or raises them answers
`partyRolling`, earlier. It is its own slice: `applyAttack` has five callers, and the runner's
`check` defers the same clear on purpose (`runner.ts`, "whoever is acting when the dice are
settled").

`npx tsc --noEmit` clean; vitest **1841 passed (1841)** -- the first fully green unit run since `f4df9fa`;
Playwright **105 passed (3.7m)**, `EXIT 0`.

## The docs stop naming what is gone — done

The reference docs described a repository that no longer exists. `DEVELOPING.md` and
`developer-guide.html` lose the vendored-sources section, the generated-docs rules, the
`content/srd/` rows and a recipe that edited a deleted library; recipe (c) is now how a stat
block's feature is written, as a card printed on a block. The HTML guide also stops saying
`formatVersion` is 1, and gains the content-pack rows it never had. `MANUAL.md` and `CRPG-GAPS.md`
stop pointing at `docs/CARDS.md`, `docs/ADVERSARIES.md` and the catalogue's counts, and say which
four native hooks exist. A new guard, `tests/unit/doc-references.test.ts`, fails when a reference
doc names a file the repository does not have: this drift had been found by hand three times.

`npx tsc --noEmit` clean; vitest **1840 passed / 1 failed (1841)**, the one failure being the documented deliberate one;
Playwright **105 passed (3.7m)**, `EXIT 0`. The guard earned its place on its first run: it found one
reference the rewrite had missed (the build's index, named as if it were a repository file).

A second look found the guard's own hole: it read only a span's first word, so a path behind a
command (`python tools/adversaries-doc.py`, the deleted generator, named twice) passed. It reads
every word now, and its own test says so. The same look corrected a recipe that credited two test
files with what one plays, and a MANUAL line that read as if the starter pack scripted every card
(twenty-two of its thirty-nine are text, counted since: three chosen, nineteen printed features).

## Card zones — done

The loadout shows **Always in play** between the hand and the vault: what a character has
without choosing it -- class, subclass up to the stage reached, ancestry, community, and anything
a project hands them -- face up, in the order a sheet lists abilities (`grantRank`, now shared),
each saying what granted it. It reads the cards as they stand, so a card handed over is shown at
once. A granted card has no domain, level or recall, so it has a face of its own (`GrantedFace`)
in a colour of its own; a search reaches the zone and a domain filter puts it away.

`npx tsc --noEmit` clean; vitest **1838 passed / 1 failed (1839)**, the one failure being the documented deliberate one;
Playwright **105 passed (3.8m)**, `EXIT 0`. Three breaks -- the zone reading the cards as the sheet was
derived, keeping the pack's order, naming a grant by id -- each fail the test written for them.

## The grant editor — done

The Cards panel's **granted by** re-grants a project's own card: named characters, a class, a
subclass stage, an ancestry, a community, or the stat blocks that print it. `chosen` is not offered
-- a chosen card needs the loadout's four numbers, and one switched to it without them no longer
loads -- and a pack's card is shown, not edited. **Check** warns when a grant names what nothing
defines, and about a card given to nobody or printed on no block. The e2e that writes a stat
block's feature from the panel now prints it on a block, and Check has nothing to say about its
Shadow.

`npx tsc --noEmit` clean; vitest **1837 passed / 1 failed (1838)**, the one failure being the documented deliberate one;
Playwright **105 passed (3.7m)**, `EXIT 0`. Three breaks -- Check never reading a grant, taking an unknown
class on trust, not asking about the party -- each fail the test written for them.

## Cards as the unit — done

Everything a character has is a card, and so is every feature a stat block prints. Format version 3
carries it. Nothing was pushed until both sides had landed: a pushed version is a promise to every
file written under it.

* **A card says how it got into play** (`cardGrantSchema`): `chosen` into a loadout, or granted by a
  class, a subclass stage, an ancestry, a community, a project handing it to named characters, or a
  stat block printing it (`adversary`).
  Only a chosen card has a domain, a type, a level and a recall cost, and the schema asks for them
  there and nowhere else.
* **An ability sits on a card**, `source: { card }`, and there is no other source. `abilitiesFor`
  reads the card's grant and
  orders by it -- class, subclass stage, loadout, ancestry, community, given -- then by list order.
  Both tests that pinned the old order pass unchanged, which is the evidence that nothing moved.
* **Printed features are cards.** A class, subclass, ancestry or community carries none; the
  starter pack's 24 are granted cards, and the name-matching that paired a printed feature with its
  ability is gone. So are the readers for a retired data set's shapes in `pack/import.ts`, which
  nothing had called since slice 3 and which wrote exactly those features.
* **Granted is read live.** `deriveCharacter` folds a granted card's passives into the numbers; the
  world and the action bar recompute a character's granted cards from the cards as they stand, each
  time they read (`grantedCards`), so a card handed over mid-scene is in hand at once -- as an
  ability written into a project always was. Two tests fail without that read.
* **The GM's side.** A stat block's feature is an ability on a card granted by `adversary`. The
  world finds a block's features through the cards (`statBlocksOf`), the validator's eleven
  stat-block checks ask the same cards, and no character is ever granted one -- a test names a block
  after a character to show it. What a block prints as traits (`features`: Relentless, Horde,
  Minion, Momentum, Terrifying) stays on the block: those are rules `adversaryTraits` reads, the same
  boundary as a weapon's features. Tests write a feature once and print it on its blocks with
  `printed(blocks, feature)`.
* **The editor.** "+ Card" writes a `given` card and the ability on it as one undo step, ✕ takes
  both back, and "held by" edits the card's characters. **Check** warns about an ability on a card nothing defines: under
  this model that ability is silently never in play.
* **The migration** (version 3, positional) builds a card for every ability that sat on something
  other than a card -- a stat block's feature among them -- granted the way its source said, and turns printed features into granted cards
  -- joining one to its ability's card when both are in the same document, and never matching
  against the shipped pack, which is code a document cannot see. The frozen version-1 project comes
  through with its seven such abilities on seven built cards.
* **The export, re-read.** `srd.json` now reads as 334 cards (189 chosen, 145 printed) and
  `srd-abilities.json` as 8 cards beside its 185 abilities. **Known:** imported together, those 8
  duplicate printed cards by name under other ids, because the two files were exported apart and are
  read apart. Merging them is the owner's call, not a migration's guess. Neither file carries a stat
  block's feature, so the GM's side changed neither count.

`npx tsc --noEmit` clean; vitest **1835 passed / 1 failed (1836)**, the one failure being the documented
deliberate one; Playwright **105 passed (3.7m)**, `EXIT 0`. Five breaks -- the world reading no cards, a
feature reaching every block, a stat block's card granted to a character, the validator asking no
cards, the migration skipping a stat block -- each fail the tests written for them.

**Next, in order:** what *The card editor* lists as still open (the grant editor, the card zones and
the card editor have landed, above).

---

## Import pack — done

The exported catalogue is reachable again. **Project ▾ → Import pack…** reads one or more pack files
and lays their content into the project being edited, id for id, as one undo step. The state the
handoff called "preserved but unreachable" is closed.

* **The file format** is `packDocumentSchema` (`content/pack/document.ts`): `contentPackSchema` plus
  `abilities` and `conditionDefs`. That is the fix for "a pack has no conditions field" — a card
  that applies a condition now travels with the condition, and with its script. A project file
  reads as a pack too.
* **The reader**, `readPack`, migrates first like every door, then validates each entry on its own:
  a broken entry is skipped and reported as a `ContentIssue`, and a newer build's file or one with
  nothing readable is refused. Importers still never throw.
* **The edit**, `importPack` in `editor/session.ts`, replaces a same-id entry where it stands and
  appends the rest, **in place** — the script world holds `project.abilities` by reference, so a
  fresh array would leave it reading the old one. A test fails exactly that way without it.
* **Replace, not keep**, on a same-id collision: importing is somebody choosing a file, and a pack
  re-exported with a fix should land the fix. The cost is a customised card imported over, which is
  why it is one undo and why the message counts what it replaced.
* The Combat strip and the validator's known adversaries read `adversaryDefsFor(project)` on every
  draw instead of a module constant, so an imported stat block can be placed.
* Not a load. An import is refused only in **play**, mid-prompt or mid-fight, where the world would
  be rebuilt under the question; in the editor the world is rebuilt on the way back to play, as it
  is for every other content edit.

**Verified on the real export, locally.** Both `packs/*.json` import with zero issues — 192 weapons,
34 armors, 9 classes, 18 ancestries, 9 communities, 18 subclasses, 189 cards, 129 adversaries, 185
abilities, 54 conditions — and an imported card was put in a loadout, offered, played, and applied
its imported condition. `document.test.ts` keeps the read as a `skipIf`: it runs where the
git-ignored export exists and reports skipped everywhere else. Importing the abilities file replaces
the 54 condition ids the demo project already carries, because the export holds the engine's
generic rules conditions too.

`npx tsc --noEmit` clean; vitest **1821 passed / 1 failed (1822)**, the one being the documented
deliberate `demo-defense` failure; Playwright **105 passed**, `EXIT 0`.

**Still open on the same thread.** Classes and subclasses carry no feature text any more -- what
they print is cards (above), and the Cards panel edits them, an imported class's included (*The card
editor*, above), and a project's content goes back out as a pack through Project ▾ → Export pack
(*Export pack*, above). Nothing is left on this thread.

**Known, and not new:** undoing an import while in *play* rewrites the document but not the running
world. `undoEdit` rebuilds nothing in play, so an undone card stays offered until the next rebuild —
a trip through the editor does it. Every content undo made in play has this shape; the fix belongs in
`undoEdit` and `redoEdit` for all edit kinds, not in the import.

---

## Slice 3 — done

The vendored catalogue is gone: 88 files, 39,652 deletions, including the 2.1 MB
`tools/srd-sources/` tree, `src/engine/content/srd/` entire, 182 KB of card scripts, 162 KB of
stat-block features, two doc generators and the two docs they generated. `tsc` clean, **Playwright
103 passed** — the same count as the baseline taken deliberately *before* the deletion, so the
deletion is what was verified rather than the deletion plus something else — and 1772 unit tests
passing with the one documented deliberate failure. The drop from 1828 is the 55
catalogue-integrity tests leaving with the catalogue they were about, which is exactly what
splitting them into `*-catalogue.test.ts` files was for.

**Exported before anything was removed**, because the rule is that this content stays importable
rather than lost. `packs/srd.json` holds the content as one `contentPackSchema` document (192
weapons, 34 armours, 9 classes, 18 ancestries, 9 communities, 18 subclasses, 189 cards, 129
adversaries, zero import issues). `packs/srd-abilities.json` holds the mechanics — 185 abilities
and 54 conditions — in the shape `projectSchema` accepts, because abilities belong to a project and
a pack alone would have been names and text with every script dropped. Both are git-ignored, and
the tool that wrote them went with the sources it read.

Four code changes came first, each on a tree that stayed green: `content/srd/hooks.ts` moved to
`script/native-hooks.ts` (engine code — four computations the effect vocabulary cannot express, one
of them already named by a fixture); `main.ts` hands the editor the starter pack as its ability
library, which narrows the Ability panel from 185 entries to 14; `withStatBlockFeatures` is gone, so
what a project places is what it carries; and `authored-scenario.test.ts` stopped loading 185
abilities for two tests whose blocks carry their own.

`licensing-boundary.test.ts` used to read `tools/srd-sources/official-2.0/README.md` to prove the
PDF was never vendored. It now makes the stronger claim — no vendored SRD source in the tree at all
— and pins both attributions where they live, `docs/CONTEXT.md`. CONTEXT.md itself lost 40 lines of
sourcing directions and kept what outlives them: the notices, and the 2.0-versus-1.0 findings that
explain what `cover.ts`, `los.ts` and `area.ts` implement.

**What slice 3 did not do, and is worth knowing next:**

* ~~`contentPackSchema` still has no `conditions` field~~ — **closed** by the pack file format,
  `packDocumentSchema`, which is `contentPackSchema` plus `abilities` and `conditionDefs`. The
  export's sidecar is simply a second pack.
* ~~**Nothing reads a pack from disk.**~~ — **closed**: Project ▾ → Import pack…, above.
* `cut-purse-strings`, `rallying-cry` and `smoke-step` still ship as text only.
* `holding-the-line` and `caught-in-the-line` still sit in `content/conditions.ts` rather than
  beside the feature that arms them.

---

**Pinned to commit `c65508a`.** At that commit: `npx tsc --noEmit` clean, **1821 of 1822 unit tests
passing across 92 files**. The single failure is the documented deliberate one in
`demo-defense.test.ts` — a Stress assertion left red after four attempts rather than guessed at, with
what was ruled out recorded in its commit (resolved since: see *The lift's red test*, at the top).
**Playwright is green: 105 passed, 3.8 minutes, `EXIT 0`** — a full run, not a tally of targeted
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
so the caster-runs-the-line assertion left with Deathrun; and `demo:1819`'s Light-cost assertion
contradicted the pack's rule of spending no Light. One silent guard became an assertion and fired
immediately — `if (targets.length > 1)` had been skipping a whole arm-and-disarm path whenever one
husk stood adjacent, which is the fifth vacuous pass found this way.

**What this uncovered and did not fix.** `contentPackSchema` has no `conditions` field: a project
*document* carries `conditionDefs` and `worldOptions` merges them, but a content *pack* cannot. So a
card that applies a zone condition cannot be imported with the condition it depends on — and a zone
whose condition is missing is silent *and* writes the condition's id into the log, because
`conditionName` falls back to it. Closing that is the next slice for mechanics travelling on cards. *(Closed since: a pack file is
`packDocumentSchema`, which carries conditions.)*
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
| `demo:1819` | a Light cost, a check, an Experience pick, a named target | an ember action with a `check` |
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

**1. Remove the borrowed DNA.** The project carries no third-party tabletop IP going forward. Usable
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
Nine test files read the vendored folder off disk at runtime and fail the moment it goes. They
are engine-layer tests using the catalogue as a content fixture, which is why a game-layer sweep
never touched them. **Six are done, one dies with the slice, two are left.**

| File | State |
|---|---|
| `editor/item-edits.test.ts` | **done** — reads the shipped pack |
| `editor/party-edits.test.ts` | **done** — reads the shipped pack |
| `engine/character/sheet.test.ts` | **done** — split; catalogue half is `sheet-catalogue.test.ts` |
| `engine/content/abilities.test.ts` | **done** — split; catalogue half is `abilities-catalogue.test.ts` |
| `engine/combat/adversary-features.test.ts` | **done** — an inline printed block, no catalogue |
| `tests/unit/demo-map-fight.test.ts` | **done** — both fighters are fixtures |
| `engine/content/srd/library.test.ts` | **dies with the slice** — all three blocks are about the shipped library |
| `engine/script/abilities.test.ts` | **left** — specified below |
| `engine/character/progression.test.ts` | **left** — blocked on content, see below |

**`script/abilities.test.ts`, specified.** Read end to end; the old one-line summary was true and
the least of it.

* Two hand-written sheets in `scene()` re-pin: Kara guardian/chainmail/broadsword/stalwart holding
  `bare-bones`+`get-back-up` → sentinel/ringmail/longsword/shieldbearer holding
  `power-slash`+`iron-stance`; Mira wizard/gambeson/greatstaff/school-of-knowledge holding
  `book-of-ava`+`rune-ward` → emberwright/padded-coat/ember-staff/flamecaller holding
  `arcane-ward`+`healing-word`. `deriveCharacter` is asserted issue-free, so both must resolve.
* The content bag at 147–150 points at `STARTER_ABILITIES` + `SRD_CONDITIONS`. All five conditions
  the file uses — `hidden`, `in-shadow`, `stunned`, `asleep`, `horrified` — are generic *rules*
  conditions (blocks, endsWhen, advantage modifiers), not card markers, so they survive the prune
  and need no fixture. That removes a whole strand of expected work.
* **Two weapon-arithmetic sites, and one assertion flips.** Line 906 scripts `[10, 2, 6]` against
  soft-husk (difficulty 10, thresholds 7/12): Light 10 + Shadow 2 + Strength 2 = 14 hits, then the
  broadsword's `1d8+0` rolls 6 → Minor → `hitPointsMarked: 1`. The longsword is `1d8+1` → **7,
  which meets the major threshold exactly → 2 Hit Points**, so that assertion and its comment both
  change. Lines 1328–1330 pin `weaponDamage`: Kara `1d8+0` → `1d8+1`, Mira's greatstaff `1d6` →
  the ember-staff's `1d8` magic. Nothing else moves — 1119 and 1175 state `damage: '12 phy'`
  outright rather than rolling a weapon, and 1293's `1d8` belongs to a test that lifts.
* **A new ungated `incomingDamage` fixture reaction** for the two `reactionsOf('kara')` lines
  (1380, 1385), which currently expect `get-back-up`. `reactionsOf` is `reactionsFor(id,
  'incomingDamage')`, and the pack ships no reaction at all. The two fixture reactions that do
  trigger on it are gated — `fixture-aura-layers` on held tokens, `fixture-bone-bound` on a
  four-card fixture loadout plus 3 Light — and both are imported by `demo-abilities`/`demo-cards`,
  so loosening either to suit this file would be wrong. A plain specimen beside the assertion is
  the idiom `cards.ts` already states.
* **Four tests lift** to `script/abilities-catalogue.test.ts`: `describe('the shipped cards')`
  entire (1278–1361, all four about Whirlwind, Bolt Beacon and the rest), plus the two
  card-specific tests inside `a hook in a script` (1444–1462 Arcane Barrage's option labels,
  1464–1475 Wild Flame's three-target cap). This is the first file where a describe does **not**
  split on its boundary: that block's first three tests write their own hooks inline via `code:`
  and name no content, so they stay.

**`progression.test.ts` is blocked on content, not naming.** `describe('the import')` is a
catalogue block and lifts cleanly. The rest cannot convert onto the starter pack: the pack ships
cards at **levels 1 and 2 only** (nine and six), while the climb runs to level 6 and needs
`fromTier: 2` picks, `champions-edge`, `fortified-armor` and `deadly-focus`; and `multiclassing`
needs a class with two domains and a fourth domain to open, where the pack has three classes of
one domain each (bulwark, shadow, ember) and exactly three card domains. The fixtures ship no
classes or subclasses at all. So this one wants a fixture module spanning tiers — classes,
subclasses and levelled cards — which is authoring, not a re-pin, and is the last thing standing
between here and slice 3.

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

- **Light and Shadow.** Landed in two passes. What a player reads became **Light** and **Shadow**
  (686 display sites, 69 files); what a document stores became `good` and `bad` (74 files, a 1:1
  substitution). The split has a front and a back because `light` and `shadow` cannot be identifiers
  here — `spotlight` is the engine's own turn concept with 249 uses, and the renderer has shadow
  mapping. This was a **document format change**, not a rename: the pool enum, the pool selector,
  four `checkRequestSchema` keys (real persisted keys), four `RollOutcome` values, the UI labels in
  `DiceTray` and `PartyHud`, and the pool test ids the pips carry — which the e2e selectors read.
- **`formatVersion` 1 → 2**, with a load-time migration that rewrites a version-1 document rather
  than rejecting it. **Exercised on a real version-1 fixture**, or it is a promise rather than a
  behaviour.
- **Identity.** ~~Done.~~ `package.json` name → `tactical-engine` (and the derived name in
  `package-lock.json`), `<title>` → Tactical Engine, the editor top bar, and the retired name gone
  from 25 files. The e2e driver handle became `window.__engine`, 438 sites across 24 files — one
  literal, so `src/main.ts`'s `declare global` and `demo.spec.ts`'s hand-written mirror could not
  drift apart (`6767b90` has the old spelling, which the guard now forbids here). Three populations were protected: the prototype's persisted keys, the app's
  own three `localStorage` prefixes (now read as a fallback so nobody's saves are orphaned), and the
  RNG seeds in `rng.test.ts`.

  *This line previously read "Tactical Engine retired", which is nonsense.* The substitution that
  renamed the product could not tell the name being **adopted** from the name being **retired**, and
  inverted the sentence. The pass was protected against doubling (`Tactical Engine Engine`) but not
  against that. An audit for the same shape found one more — the content-pack spec's §11, which read
  "**Tactical Engine is retired** — its echo of…", where the trailing clause was the reason the
  *old* name had to go — and no others. Two inversions across 25 files, both in prose that named the
  retired name in order to retire it. Neither is a boundary breach, and the guard would not have
  caught either: one is in `docs/superpowers/`, which it exempts by design.
- **`legacy/` prose.** ~~Done~~, but the amendment's premise was wrong and the correction is worth
  keeping. The owner's ruling lifted the never-modify rule on the stated grounds that "all eight
  marks there are cosmetic comments and one editor hint, none functional". Measured: there are
  **20** marks, and three are functional — `polyheart-campaign` is written at
  `legacy/js/editor.js:170` and read at `main.js:23`, and `polyheart-map` is read at `main.js:29`.
  Those are persisted `localStorage` keys, so renaming them orphans any campaign or map somebody
  saved in the prototype. The prose was rewritten and the keys were left, which is the spirit of the
  amendment rather than its letter. `legacy/`'s 59 Light/Shadow sites were left too: 19 are live
  identifiers in `legacy/js/game.js`, and `legacy/README.md:50-65` documents the prototype's
  mechanics against its own code.
- **The guard.** ~~Done~~ in `tests/unit/licensing-boundary.test.ts`: three sweeps over what
  `git ls-files` reports, plus the existing check that `tools/srd-sources/` does not exist.

  The marks rule cannot be "never" — the DPCGL *obliges* the attribution — so an occurrence is
  legitimate when a licensing phrase sits within **±2 lines**. The window, not the line: attribution
  paragraphs wrap mid-phrase (that file splits "System Reference / Document" across a break), so a
  per-line rule fails on the notices themselves, and reflowing a licensing paragraph would fail the
  boundary for no real reason. Two drafts of the doc passes broke exactly that way.

  Exemptions are named with reasons, never convenience: `legacy/`, `docs/research/`,
  `docs/superpowers/` (dated design records — a spec arguing for removing this IP must be able to
  name it), and the guard itself, whose rules have to spell the terms they forbid.

  Shown to fail without its fix, by injection into a tracked file that was clean first and reverted
  after: a sentence branding the engine as the licensed product made rule 1 fail and name the line,
  and a line carrying the retired product name made rule 2 fail. The guard was re-run green on the
  restored tree. Rule 3 needed no injection — it caught a real offender on its first run, a comment
  in `save.test.ts` naming the old pool field, which was reworded rather than added to the exemption
  list.

  **Note for whoever edits this entry:** the injected strings cannot be quoted verbatim here. This
  file is not exempt, so a doc recording the guard's own falsification trips the guard — describe
  the injections instead of spelling them.

### 3. Cards as the unit — the model is done; what is left is on screen

The decisions taken when building are the spec's §7: an ability points at its card; the card names
what grants it and nothing lists its cards; only a chosen card has the loadout's numbers; the
version-3 migration is positional and builds cards from abilities; a stat block's traits stay on the
block. What landed is the entry at the top of this file. What is left, in order:

- **Zones on screen** are done for a character: the loadout's **Always in play**. The action bar
  still wears art only on a chosen card's ability.
- **Editing any card.** The grant editor is done; left is a card editor that reaches a pack's card,
  and a chosen card's domain, type, level and recall cost.
- **Cheaper, not different:** the world's `cards` option is a closure that merges the pack on every
  read. The live read that two tests pin is `inPlay` recomputing a character's granted cards; a map
  built when the world is, if every content change rebuilds the world, would do. Measure first.
- **A stat block's cards on the table.** They are data only: nothing shows the GM's side as cards.
- **Open, not decided:** a condition that lends a *card* rather than an ability
  (`conditionDefSchema.grants`), and whether a card handed over mid-fight should be announced.

**Not a licence to rebuild the catalogue with a card model instead of a list.** The IP constraints
are untouched by this.

### 4. The pack surface: choosing one, and editing cards

The *mechanism* already exists — the spec is explicit that packs load through the existing project
load path, and no new runtime is invented. `projectSchema` carries the seven content fields,
`mergePack` lays a project's lists over the pack's by id (project wins, base survives), and the
test fixtures are a working demonstration: ~40 specimens across three files push content into a
project and play it, which is exactly what an import does.

What is missing is the surface:

- ~~a picker that reads a pack file, validates it, and hands it to that path~~ — **done**, though not
  through the load path: Project ▾ → Import pack… lays a pack into the project as an edit;
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
`window.__engine.buildingStats()` — a handle whose name changes with the identity rename.

### 10. Zip project export

`fflate` is a dependency and is imported nowhere under `src/`. `CONTEXT.md`'s "zip import and export
of projects with assets" is not implemented — export is `JSON.stringify` into a `Blob`, so a project
with imported assets cannot be handed to anyone as one file. This matters more once packs are a
product: a pack with art is the same problem.

---

## 3. Known doc drift

`DEVELOPING.md` labels its old line anchors as historical; use symbol names to find current
implementations.

Slice 3's drift is cleaned up: no reference doc -- `DEVELOPING.md`, its HTML twin, `MANUAL.md`,
`CRPG-GAPS.md` -- names a file the repository does not have, and
`tests/unit/doc-references.test.ts` keeps it that way. A record of what was removed (this file,
`CONTEXT.md`, `AGENTS.md`) still names what it removed, which is its job. No doc quotes a count of
catalogue content any more: the catalogue is a pack now, and its numbers are its own.

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

**Read the file into a variable before opening it for writing.** `open(p, 'w').write(read(p)...)`
opens -- and truncates -- before its argument is evaluated, so it reads back an empty file and
writes that. It emptied two files here once, recovered only because every change since HEAD was
still in a script. Build each file's whole text in memory, then open it.

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

`src/main.ts` declares `window.__engine` in a `declare global` block, and
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

### What the guard sees, and what must keep the old names

Carried over from the slice-4 handoff when it was deleted, because nothing else records them.

* **The licensing guard reads `git ls-files`, so an untracked file is invisible to it.** A green run
  says nothing about a file that is not staged: the handoff itself passed 6/6 while untracked and
  showed six violations the moment it was added. `git add` a new file before trusting the guard.
* **When a guard rule fails, fix the source, not the exemption list.** Exempting the file that
  tripped rule 3 would have blinded it in the one file about persisted documents.
* **Some files keep the version-1 names on purpose.** `scene/migrate.ts` and `migrate.test.ts` read
  and table the old field names; `scene/legacy-import.ts` maps the prototype's own document keys. A
  rename pass over them stops the migration migrating **while every one of its tests still passes**
  — the failure only surfaces when somebody loads an old save. The guard's `DELIBERATE` list names
  them.
* **The version-1 fixtures are evidence, not test data.** `tests/fixtures/v1/` is never edited and
  never regenerated; its README says why. Read it, as `document.test.ts` does, and leave it alone.
* **A storage-key fallback is get / set / remove, and remove is the one that goes wrong.** Read the
  current key then the old one; write the current key only; remove **both**. Clearing only the
  current key lets a deleted save come back on the next read, which presents as the delete button
  not working. `save-slots.ts` and `ui/card-art.ts` each have a test asserting the old key is gone.

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
