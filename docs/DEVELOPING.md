# Tactical Engine — Developer Guide

For whoever picks up work in this repository next, human or agent. It says where things are,
which way they point, what may not be broken, and the order to touch files in for the changes
that keep recurring. It is a reference to look things up in, not a tutorial to read through.

**Which doc covers what.** Four files, no overlap:

| Doc | Covers |
|---|---|
| `docs/CONTEXT.md` | The goal, the hard constraints, the chosen stack, what became of the SRD sources, and the house rules. Read it first; it is the working agreement. |
| `docs/BACKLOG.md` | What to build next, ranked, and the working rules learned the expensive way: the patch-script protocol, the driver-type mirror, what to run before claiming done. Read it second. |
| `docs/MANUAL.md` | Playing the demo and authoring content in the editor. Every panel, every field, every verb. Hand-written, user-facing. |
| **this file** | Extending the engine: adding an effect, a condition, a passive, a panel field, an SRD feature, a rule. |

Nothing in `docs/` is generated any more: the card and adversary listings went with the catalogue
they listed. `docs/CRPG-GAPS.md` is an honest audit against the CRPG goal — read it before claiming
a system exists. `docs/research/legacy-{game,campaign,editor-ui,models}.md` are static-analysis
notes on the legacy prototype with `file:line` anchors; read those instead of re-reading `legacy/`.

The same page arranged for reading rather than lookup is `docs/developer-guide.html` — open it from
`file://`, it fetches nothing.

**Line counts and `file:line` anchors below are historical, as of commit `058c3af`.**
A working tree part-way through a slice moves them; the symbol name is the stable handle, and
`grep -a` finds it.

---

## 1. Orientation

Tactical Engine is a browser CRPG engine and editor for party-based tactical RPGs. A *project* is
a JSON document (`projectSchema`, `src/engine/scene/schema.ts:210`) holding scenes, dialogues,
items, loot tables, quests, assets, abilities, code, condition definitions and the party. The engine
executes that document directly; the editor writes it in the browser. There is one page, one canvas
and one Preact root, and a mode switch between play and edit.

### Where to start reading

In this order, and no further until you need it:

1. `docs/CONTEXT.md` — the constraints.
2. `src/engine/script/schema.ts` (624 lines) — the effect and condition vocabulary. Everything
   content can say is in this one file.
3. `src/engine/script/runner.ts` (1095 lines) — the stepper that runs it, and the `ScriptWorld`
   interface it runs against.
4. `src/engine/rules/damage.ts` (358 lines) — the shape of a rules module: SRD citation at the top,
   pure functions, an `Rng` passed in wherever dice are rolled.
5. `src/game/demo-scene.ts` (2435 lines) — where the engine is actually wired into a playable thing.
6. `src/main.ts` (1578 lines) — the boot path. It owns the board, play and global keys
   (`Ctrl+E`, `Ctrl+Z`); the editor shell (`src/editor/ui/EditorShell.tsx`) also listens, for its
   own keys (`1`-`4`, `Esc`) and for a click outside an open menu.

### The layer map

```
  the page        src/main.ts   ·  engine/render/  ·  editor/ui/  ·  window.__engine
  (DOM, WebGL)         |                 |                |
                       v                 v                v
  the glue        src/game/  (demo-scene.ts and friends)   src/editor/ (session.ts, validate.ts)
                       |                                        |
                       v                                        v
  the core        src/engine/  — rules · combat · script · content · scene · grid ·
                                 character · dialogue · core
                  no DOM, no WebGL, runs under Vitest in node
```

Imports point downwards only. `src/engine/**` (except `render/`) imports nothing from `src/game/`,
`src/editor/` or `src/main.ts`, and no browser library. That rule is enforced by a test, not by
convention: `tests/unit/engine-is-headless.test.ts` walks every non-test source under
`src/engine/` bar `render/`, and fails on an import of `three`, `three-mesh-bvh`, `cannon-es`,
`preact` or `@preact/signals`, on any use of `document`, `window`, `navigator`, `localStorage` or
`requestAnimationFrame`, and on any call to `Math.random()`. Its last case proves the checks are not
vacuous by running them against a deliberately bad source.

`src/engine/render/` is the one part of the core allowed to touch WebGL, and it is a one-way
adapter: the rest of the core does not know it exists.

---

## 2. Directory map

### `src/engine/` — the core

| Path | What it is |
|---|---|
| `core/rng.ts` | `Rng` (SplitMix32), `createRng`, `hashSeed`. `save`/`restore`/`fork` for replays. |
| `rules/dice.ts` | `parseDice`, `rollDice`, `withProficiency`, `maxDice`, `formatDice`; `DiceExpression`, `ParsedDamage`, `DamageType`. |
| `rules/duality.ts` | `rollDuality` — a PC's two dice, the five outcomes, Light/Shadow/spotlight. |
| `rules/gm-die.ts` | `rollGmDie` — the GM's single d20 against Evasion, natural-20 crit. |
| `rules/damage.ts` | Thresholds, severity bands, Armor Slots, resistance/immunity/reduction, `rollDamage`, `resolveDamage`. |
| `rules/countdown.ts` | The clock: `advanceCountdown`, `stepsFor`, `dynamicSteps` (the SRD's progress/consequence chart), loops. No effects, no rng. |
| `rules/cover.ts` | SRD 2.0 cover: a partial obstruction costs the attacker a disadvantage die. |
| `rules/range.ts` | `RANGE_BANDS`, `DEFAULT_BAND_TILES` (a house rule — see CONTEXT.md). |
| `rules/resources.ts` | `MarkPool` and `Currency`: Hit Points, Stress, Armor Slots, Light, Shadow; `mark`, `unmarked`, `canAfford`, `markHitPoints`. |
| `combat/attack.ts` | `resolveAttack` (pure) and `applyAttack` (the only mutator here); `AttackProfile`, `DefenderProfile`, `AttackOutcome`. |
| `combat/defense.ts` | The defender's side: `Defender`, `resolveDefense`, `resolveDefensePlan`, `previewPlan`, `canPayFor`. |
| `combat/targeting.ts` | `evaluateTarget` — range band, line of sight, cover, refusals. |
| `combat/area.ts` | SRD 2.0 Area of Effect and Movement Under Pressure. |
| `combat/encounter.ts` | Turn and spotlight order. |
| `combat/adversary-features.ts` | Role features read structurally off a stat block: `IMPLEMENTED_FEATURES = ['relentless', 'momentum', 'terrifying', 'horde', 'minion']`. |
| `grid/grid.ts` | `TileGrid`, `NO_TILE`. |
| `grid/los.ts` | Line of sight, and the house rule for partial vs total obstruction. |
| `grid/pathfinding.ts` | `Pathfinder`, reachable fields (509 lines). |
| `grid/terrain.ts` | Terrain types and their movement cost. |
| `script/schema.ts` | **The one vocabulary.** `conditionSchema`, `effectSchema`, `checkRequestSchema`, `targetSelectorSchema`, `COUNT_NAMES`, `amountReadSchema` (an amount off a pool), and the `walk*` visitors. |
| `script/effects.ts` | Behaviour over those shapes: `outcomeEffects` (the five-outcome fallback) and TypeScript constructors. Re-exports the types from `schema.ts`. |
| `script/conditions.ts` | Evaluating a `Condition` against a `ConditionContext`; `TargetBindings` (`targets`, `hit`, and the optional `counts`), `NO_BINDINGS`, `countOf`. |
| `script/runner.ts` | `ScriptRunner` (the stepper), `ScriptWorld` (what the world must provide), `JournalEntry`, `Prompt`, `Response`, `RunStatus`. |
| `script/world.ts` | `SceneScriptWorld` — the only writer of scene state (1330 lines). `ScenarioState`, `worldOptions`' counterpart types. Movement lives here too: `drawIn` walks a creature towards another until it is within a band, `breakAway` walks it as far off as it can get, both within a band as the crow flies and both refused while something holds it. |
| `script/countdowns.ts` | The board a scenario carries: `RunningCountdown` (a clock plus what it is counting towards), `advanceBoard`, `reapBoard`, `endCreatureCountdowns`, and the snapshot schema a save uses. |
| `script/hooks.ts` | Running project code: `HookContext`, `runHook`, `SAFE_MATH`. |
| `content/types.ts` | `AdversaryDef`, `AdversaryFeature`, `ContentIssue`, `ImportResult`, `toContentId`. |
| `content/abilities.ts` | `AbilityDef` and its sub-schemas; `abilitiesFor`, `loadoutOf`, `cardOf`, `grantRank`, `statBlocksOf`, `isStatBlockFeature`, `isScripted`, `isAutomatic`, `readsATarget`. An ability sits on a card (`source: { card }`) and is in play when its card is -- chosen and in the loadout, or granted; a stat block's feature is an ability on a card granted by `adversary`, and `statBlocksOf` says which blocks print it. A modifier's `advantage` stat is a signed count of dice, `against: true` puts it on rolls made at the holder, `plusProficiency` adds their Proficiency, and `perToken` multiplies the whole bonus by the tokens on a card — never folded into a derived character, because tokens are scene state. A passive's `standardAttack` changes the block's own swing (`direct`, `damage`, `double`), with `when` read from the attacker's chair and the target bound. `target.when` says what makes a creature worth aiming at, read once per candidate by both the player's list and the GM's. |
| `content/conditions.ts` | `ConditionDef` — what a *status* on a creature does. `SRD_CONDITIONS`. |
| `content/items.ts`, `content/quests.ts` | Item and quest content shapes. |
| `content/pack/schema.ts` | What a content pack *is*, as zod: `featureSchema`, `weaponDefSchema`, `armorDefSchema`, `classDefSchema`, `ancestryDefSchema`, `communityDefSchema`, `subclassDefSchema`, `cardDefSchema` with its `cardGrantSchema`, and `contentPackSchema`. A class, subclass, ancestry or community carries no printed features: those are cards that name what grants them. The contract a pack is validated against, wherever it comes from. |
| `content/pack/import.ts` | The pack in memory: `ContentPack` (maps by id), the def types, `CardGrant`, `isDomainCard` (a chosen card, with the loadout's numbers), and `mergePack`, which lays a project's lists over a pack's. The readers for a retired data set's shapes are gone; a pack *file* comes in through `document.ts`. |
| `content/pack/document.ts` | A pack as a **file**: `packDocumentSchema` (`contentPackSchema` plus `abilities` and `conditionDefs`), `readPack` (migrates, then validates each entry on its own and reports what it skipped) and `describePack`. What Project ▾ → Import pack… reads; `importPack` in `editor/session.ts` lays it into the project. |
| `content/pack/starter.ts` | The pack the engine ships, its own and nobody else's: `STARTER_PACK`, `STARTER_CHARACTERS` (the character side as a `ContentPack`), `STARTER_ADVERSARIES`. Its stat blocks carry printed traits and no scripted features. |
| `content/pack/starter-abilities.ts`, `starter-conditions.ts` | `STARTER_ABILITIES` and `STARTER_CONDITIONS`: what the starter pack's cards do, and the conditions they apply. |
| `script/native-hooks.ts` | `SRD_HOOKS` — the four native hooks, for mechanics that are a computation rather than a list of effects. Engine code, which is why it stayed when the catalogue went. |
| `scene/primitives.ts` | `contentIdSchema`, `traitSchema`, `pointSchema`. Exists to break an import cycle between the two zod modules. |
| `scene/schema.ts` | The authored document: `sceneSchema`, `projectSchema`, `ProjectDoc`, `codeSchema`. |
| `scene/state.ts` | Runtime overlay: `EntityState`, `SceneState`, `SceneStateSnapshot`, `sceneStateFromScene`. |
| `scene/grid-from-scene.ts` | Builds a `TileGrid` from a `SceneDoc`. |
| `scene/party.ts` | Selection and follower movement. |
| `scene/interact.ts`, `scene/triggers.ts` | Interactables and trigger cells. |
| `scene/legacy-import.ts` | Reads the legacy prototype's maps (482 lines). |
| `character/sheet.ts`, `sheet-schema.ts` | An authored `CharacterSheet` and the `DerivedCharacter` computed from it. |
| `character/progression.ts` | Levelling, subclass stages. |
| `dialogue/schema.ts`, `dialogue.ts`, `layout.ts` | Conversation graphs and their editor layout. |
| `render/scene-view.ts` | `SceneView` — engine state to three.js objects, one way (457 lines). |
| `render/camera.ts` | `OrbitCamera`, plain data, deliberately not three's `OrbitControls` so it is testable headless. |
| `render/assets.ts` | `AssetLibrary` — glTF/GLB loading. |
| `render/layout.ts` | The only place that knows tile-to-world scale. |
| `render/terrain-mesh.ts` | Continuous legacy ground mesh per terrain type. |
| `scene/building.ts`, `render/building-view.ts` | Sparse construction schema and chunked instanced LOD; `editor/building.ts` owns reversible cell edits. |
| `render/procedural/` | `spec.ts`, `registry.ts` (falls back to a placeholder rather than throwing; `missing()` lists unresolved ids), `build.ts`, `library/{heroes,monsters,props}.ts`. |

There is **no `src/engine/audio/` and no `src/engine/input/`**. `CONTEXT.md` and
`engine-is-headless.test.ts` name them as exemptions from the headless rule, but neither directory
exists: input is DOM listeners in `src/main.ts`, and there is no audio system at all.

### `src/game/` — a scene someone can play

| Path | What it is |
|---|---|
| `demo-scene.ts` | `DemoScene` and the ~60 functions over it: `buildDemoScene`, `buildProjectScene`, `worldOptions`, `attackWithSelected`, `playGmTurn`, `endTurn`, `defenseChoices`, `applyDefenseChoice`, `useSelectedOn`, `answerPending`, `travelTo`, `equipItem`, `applyLevelUp`. |
| `demo-abilities.ts` | Using a card: cost, targeting, the runner. |
| `demo-code.ts`, `demo-dialogue.ts`, `demo-items.ts`, `demo-quests.ts`, `demo-scenes.ts` | The demo project's content. |
| `save.ts` | `saveSchema`, `saveGame`, `loadGame`, `saveBlockedBy`. A save is state layered over a project, not a copy of it. |
| `save-slots.ts` | `localStorage` when there is one, an in-memory store otherwise. |
| `ui/` | `ActionBar`, `PartyHud`, `PlayPanel`, `LoadoutPanel`, `LevelUpPanel`, `RestPanel` (Preact). |

### `src/editor/` — a project someone can edit

| Path | What it is |
|---|---|
| `session.ts` | The command/undo model (1590 lines). An `Edit` is `{ label, apply, undo, mergeKey?, absorb?, isNoop? }`; `EditorSession.run` coalesces a brush drag into one undo step rather than snapshotting the grid. Command functions grouped by domain: terrain/deco, interactables, encounters, scenes, dialogues, quests, assets, items/loot, party, abilities, code. |
| `controller.ts` | What a click means given the tool in hand; `CONTINUOUS` tools coalesce. |
| `modes.ts` | The top bar's four modes and the tools each owns. Choosing a tool chooses its mode, so the two never disagree. |
| `library.ts` | What the bottom strip offers (ground, props, objects, creatures by tier) and what a search there matches. |
| `validate.ts` | The **Check** button (653 lines). Reports playability problems a zod parse cannot: party, abilities, code, item uses, quests, then per scene the spawns, interactables, decos, encounters, reachability (pathfinding, run last because it is the expensive one), loot tables and dialogues. |
| `ui/EffectList.tsx` | The largest panel (930 lines): editing a list of effects, recursively. `ADDABLE` is the list of kinds it can build. |
| `ui/AbilityPanel.tsx` | An ability's fields, including `defenses` and `tokens`. |
| `ui/ConditionEditor.tsx`, `ui/CheckEditor.tsx`, `ui/TargetEditor.tsx` | The three sub-editors `EffectList` nests. |
| `ui/EditorShell.tsx` | The editor's root: which menu, workspace, conversation and problem list is open; keys 1-4 and Esc. |
| `ui/TopBar.tsx`, `ui/SceneMenu.tsx`, `ui/ToolRail.tsx`, `ui/LibraryStrip.tsx`, `ui/ModeSides.tsx`, `ui/icons.tsx` | The shell's parts: menus and modes, the scene dropdown, a mode's tools, the strip, what sits beside the board in each mode, and the icons drawn for tools and modes. |
| `ui/QuestsWorkspace.tsx`, `ui/ModelsWorkspace.tsx`, `ui/ProblemsPopover.tsx` | Quests and imported models as workspaces, and what Check found. |
| `ui/editor.css` | The purple theme's tokens on `:root`, and the shell's rules under `.ph-editor`. |
| `ui/Inspector.tsx`, `ui/DialogueGraph.tsx`, `ui/ItemPanel.tsx`, `ui/PartyPanel.tsx`, `ui/QuestEditor.tsx`, `ui/CodePanel.tsx` | The rest of the panels. |

`src/main.ts` is the boot path, and owns the board, play and global keys (`Ctrl+E`, `Ctrl+Z`).
The editor shell (`ui/EditorShell.tsx`) also listens, for its own keys (`1`-`4`, `Esc`) and for a
click outside an open menu. `index.html` holds a `<canvas id="gl">` and a `<div id="app">` and
loads `/src/main.ts`.

### `tests/`, `tools/`

`tests/unit/` holds the tests that are about the repository rather than a module:
`engine-is-headless.test.ts`, `licensing-boundary.test.ts`, `doc-references.test.ts`, the three
card-art tests (`card-art.test.ts`, `card-art-packaging.test.ts`, `card-sigil.test.ts`),
`demo-scene.test.ts`, `demo-map-fight.test.ts`, `legacy-campaign-import.test.ts` and
`spike.test.ts`. `tests/e2e/` holds `between-fights`, `building`, `card-browser`, `demo`,
`editor-panels`, `editor-shell`, `pack-import`, `placement`, `playpass`, `readout`, `save-load`
and `warden`, each a `.spec.ts`. `tests/fixtures/` holds the specimens tests play -- `cards.ts`,
`adversaries.ts`, `adversary-features.ts`, `characters.ts` -- the frozen version-1 documents in
`v1/`, and `models/` (`BoxTextured.glb`, `Duck.glb`, `Fox.glb`).

`tools/` holds `index-card-art.mjs`, which writes `public/cards/index.json` by listing that
directory, and `build-public-assets.ts`, which keeps the directory out of a production build.

---

## 3. Architecture

### The import-direction rule

The engine core is a rules library. It takes plain data and an `Rng`, returns plain data, and
mutates only what it is handed. That is what makes a fight replayable from a seed, testable in node
in milliseconds, and usable on a server. Every slice so far has relied on it; one stray
`import * as THREE` inside `rules/` would quietly end all three properties, which is why the rule is
a test rather than a comment.

### The boot path (`src/main.ts`)

1. `WebGLRenderer` over `#gl`.
2. `buildDemoScene(demoMap())` — the `DemoScene`: scene doc, grid, state, pathfinder, party, sheets,
   derived characters, triggers, `Rng`, `SceneScriptWorld`, scenario state, project, snapshots,
   dialogues, log, pending prompt, encounter, GM turn, `askDefender`.
3. `AssetLibrary`, then `SceneView` + `setDecos` + `syncTokens`.
4. `EditorSession` and `EditorController` over **the same live project object** — the editor never
   holds its own copy, because re-parsing would silently fork the document.
5. `PerspectiveCamera` + `OrbitCamera` + `frameCamera`.
6. Pointer and keyboard listeners.
7. `refreshPlay()` renders the Preact HUD into `#app`.
8. `window.__engine = state` (built inline, `src/main.ts:1198`–`1565`; assigned at `:1565`).
9. `frame()`: `steerCamera`, `view.tick`, `orbit.update`, `renderer.render`, `requestAnimationFrame`.

The render loop lives in `main.ts`, not in the render module.


### The one wire that runs the other way

`SceneScriptWorld.spotlightSpent` (`src/engine/script/world.ts:263`) is a callback the world holds
and `src/game/demo-scene.ts:810` fills in:
`demo.world.spotlightSpent = (id) => (demo.gmTurn?.spotlights[id] ?? 0) > 0`. The world runs scripts
and knows nothing about turns; the GM turn knows whose turn it is. Joining a swarm's attack *is*
being spotlighted, so a rat that has already bitten must not bite again behind the next one — and
the world cannot tell without asking. It is a field with a default that answers `false`, not an
import, so the core still compiles and tests on its own: a world with nobody keeping turns says
nobody has been spotlighted, and everyone joins. It is the only wire of its kind, and anything that
needs another should be this shape rather than an import upwards.

### The game / editor split

Both sides sit on the same `ProjectDoc` and the same `DemoScene`. The game reads the document and
runs it; the editor writes the document and asks the game to rebuild. `buildProjectScene(project)`
is the seam — a real export of `demo-scene.ts` used by the project loader, by the editor's reload
and by tests alike. Export is `JSON.stringify` into a `Blob` download; import is
`projectSchema.safeParse` then `buildProjectScene`, refused mid-prompt or mid-fight. There is **no
zip format**: `fflate` is a dependency and is not imported anywhere under `src/`.

---

## 4. The three call chains

### (a) A PC attacks an adversary

```
attackWithSelected (game/demo-scene.ts:884)
  └─ resolveAttack (engine/combat/attack.ts)          — pure, rolls and reports
       ├─ evaluateTarget (combat/targeting.ts)        — band, LOS, cover, refusal
       ├─ rollDice(profile.modifier)                  — the attack modifier's own dice
       ├─ rollDuality (rules/duality.ts)              — hit, crit, Light, Shadow, spotlight
       ├─ rollDamage (rules/damage.ts)                — Proficiency, crit bonus, flat bonus
       ├─ rollReduction (rules/damage.ts)             — the dice half of the defender's reduction
       └─ resolveDamage (rules/damage.ts)             — resistance, reduction, band, Armor Slots
  └─ applyAttack (combat/attack.ts)                   — the only mutation
```

There is **no defence step on this side.** A PC's swing is resolved and applied at once, so the
defender's reduction has to live inside `DamageDefenses` and be applied by `resolveDamage` itself —
that is the whole reason `defenses` is a field on damage rather than a step in a pipeline.

Dice leave the stream in a fixed order — modifier dice, attack roll, damage, reduction — and a
refused attack draws nothing at all, so a UI's range preview cannot shift the stream.

### (b) An adversary attacks a PC

```
playGmTurn / runGmTurn (demo-scene.ts:938, :959)
  └─ world.defenderOf(target)                          — Evasion and thresholds from the sheet,
  └─ resolveAttack  ─ rollGmDie (rules/gm-die.ts)        plus whatever the conditions add
       ├─ miss  → applyAttack at once, then offerMiss  — a card may answer a miss
       └─ hit   → offerOrLand (demo-scene.ts:1643)
            ├─ askDefender and more than one choice → demo.pending = a defence prompt
            │     defenseChoices (:1538) labels them with previewPlan (combat/defense.ts)
            │     applyDefenseChoice (:1718) → landAttack with the chosen DefensePlan
            └─ otherwise → landAttack (:1670) with plan = null
                 plan === null → world.defend → resolveDefense   (the engine decides)
                 plan !== null → resolveDefensePlan               (the player decided)
                 then applyAttack against a rebuilt AttackOutcome
```

Once the blow is resolved, whoever it happened to gets to answer it. `playDamageReactions`
drains the notes and reads them for both sides: a stat block's reactions run on their own, and
so does a party card that costs nothing and asks nothing (Rise Up's "clear a Stress"). A card
with a price — "you can spend 2 Light to…" — is put to the player as a third kind of
`demo.pending`, a `PendingReaction`, whose first option is always letting it pass. The line
between the two is `auto && no cost`: a card that would be asked about anyway sets `auto: false`.
A swing at somebody also raises `attacked` on them, hit or miss, which is how a bonus that lasts
"until after the next attack made against you" knows when it is over. A swing of the party's that
*misses* raises `dealtMiss` on whoever threw it, offered before `act` spends the turn: a miss
hands the spotlight to the GM, and a question raised on the far side of that is one the player
answers on somebody else's turn. It is not `attackMissed`, which is a swing that missed *them*.
A roll the *party* makes
raises `partyRolled` on every adversary standing: the one who rolled is bound as the target, so
the distance is a plain `withinRange`, and what the dice said is a `rolled` condition — the five
readings (`failure`, `success`, `withBad`, `withGood`, `critical`) compose, so "a failure with
Shadow" is an `all` of two. The same
happens on the party's own swing: `playAttackRiders` reads `dealtHit` and `dealtDamage` for
whoever swung, so Healing Strike is offered after a player's attack the way a stat block's rider
runs after the GM's. Every note is read before anyone is asked, because `drainDamage` clears as
it reports; what is not asked now is queued behind the question that is up. A wound is heard
however it was dealt: `world.damage` marks Hit Points outright — past the thresholds and past
any armor, which is what "force them to mark 5 Hit Points" asks for — and notes it exactly as a
rolled blow does, with nobody named.

An ability says it wants one with `target.kind: 'point'`, and the board arms for ground rather
than for creatures: `pointTiles` is what may be aimed at, `shapeAt` is who a shape would catch
from a tile without aiming it — a pure read, so the board can redraw it under the pointer — and
`useAbility(demo, id, card, [], { point })` is the click. A script can be aimed at a **tile** as
well as at a creature. `TargetBindings.point` carries it,
the same channel `targets` and `hit` come down, and three selectors read it: `inPath` is
everything the straight line from the actor to that tile runs through (`traceLine`, the same walk
sight uses, so a charge and a look down a corridor agree about what is on it), and
`around: 'point'` on `adversaries` and `allies` measures the band from the ground rather than
from anybody standing on it. `world.bandBetween(a, b)` is `bandTo` for two tiles instead of two
creatures, which is what a shape with no creature at its origin needs. A script nobody aimed
catches nobody — never an error, because a charge with nowhere to go is a charge with nowhere
to go.

What a card of the party's costs to answer with is `canPlay`, not `canPayFor`: the engine's
version reads the pools and knows nothing about how many times a card has been played this rest,
so every offer on this side asks both questions together. `payFor` is the single funnel every
play path goes through — an offered reaction, a defence chosen at the prompt, a card in place of
a death move — so that is where the use is counted.

A blow that marks a character's **last Hit Point** stops the fight for a fourth kind of
`demo.pending`, a `PendingDeath`, raised by `playDeathMoves` from `settleFight`. Where it sits
in the order is the whole rule: `EncounterRunner.checkEnd` only runs when the encounter is asked
to `act` or to `spotlight`, and `runGmTurn` will not ask for either while a question is standing,
so a lone character who Risks It All and wins is one the fight never counted out. The three moves
are the SRD's, and two of them can put the character back on their feet: **Avoid Death** (down
until an ally clears a Hit Point, then the Light Die against the character's level for a scar),
**Blaze of Glory** (one final swing at the nearest adversary in reach, resolved with
`options.automatic: 'criticalSuccess'`, and then the veil), **Risk It All** (the Duality Dice
rolled as a reaction rolls them — Light high stands them up, Shadow high does not, matching clears
everything). Avoid Death is offered first because stepping back from a question always takes its
first option, and it is the one that leaves the fight where it stands. A scar is written through `setSheet` to
`sheet.scars`, which `deriveCharacter` folds into the Light pool's maximum, so it outlives the
scene; crossing out the last slot sets `entity.dead`, which is the one thing `world.heal` will
not stand back up. Blaze of Glory is also the one swing whose attacker cannot `act` — and `act`
is where the encounter counts who is left standing — so `landPartyAttack` asks the encounter
outright with `settleIfDecided()` whenever the swing came from somebody who was not allowed to
make it.

Both defence functions use the same arithmetic in the same order: **dice off the damage** (a Rune
Ward's d8, and the passive reduction rolled once), then **Armor Slots** (the one, plus any
`extraArmor` reaction), then **the band stepped down** (`reduceSeverity` reactions).
`resolveDefense` weighs each up and spends nothing that would not lower the Hit Points marked;
`resolveDefensePlan` obeys, and pays for a reaction even when the die comes up short — which is what
happens at a table. `previewPlan` rolls nothing and returns `null` whenever an answer would need
dice.

### (c) An ability is played through the script runner

```
AbilityDef.effects  (content/abilities.ts, shapes from script/schema.ts)
  └─ new ScriptRunner(world, rng, { targets, hit, subject, rollAs })
       run(effects) → step() → apply(effect)          — one switch, no default
            ├─ instantaneous effects journal and return null
            ├─ branch / choice / check / attack / reactionRoll push a Frame
            ├─ countdown arms a clock on the scenario; the game layer ticks it
            ├─ spotlight journals who the GM's turn was handed to
            ├─ endSpotlight journals that this creature's turn is spent
            ├─ spotlightAgain journals that it takes another, already paid for
            ├─ vaultCard flags the runner; the caller that ran the card vaults it
            ├─ boostDamage journals what to add to the blow being counted
            ├─ forceHitPoints journals the Hit Points it marks instead of rolling
            ├─ forceSeverity journals the band it lands in instead of rolling
            ├─ softenBlow / avoidBlow journal what the defender's card did to it
            ├─ diceCheck rolls a handful and pushes one of two frames
            ├─ howMany builds a choice, one option per number, and pushes it
            ├─ replace takes the actor off the map and stands another block there
            ├─ move walks the actor across the ground: towards somebody, or away
            └─ choice and check return a Prompt        — the runner stops
       caller answers with resume(response)            — 'choose' | 'roll' | 'continue' | 'cancel'
  └─ SceneScriptWorld (script/world.ts)                — the only writer of state
       dealDamage → defend → resolveDefense
       attack     → builds an AttackProfile, then resolveAttack + applyAttack
       hooks (script/hooks.ts) queue more effects; they never write
  └─ JournalEntry[]                                    — what happened; the log renders it,
                                                         a test asserts on it
```

Nothing is async and nothing calls back. A whole conversation is a pure function of
(script, answers, seed). Bindings the runner carries: `targets` (what the player picked), `hit`
(whoever the last roll beat), `lastRoll` (for a critical's extra dice and `difficulty: 'roll'`) and
`lastDamage` (for `dice: 'same'`). A `Frame` may carry its own `hit`, so a reaction roll's failures
and successes each read the right list however the next roll goes.

---

## 5. The key types

| Type | Where | What it is |
|---|---|---|
| `Effect` | `engine/script/schema.ts` | The discriminated union of everything content can make happen. Inferred from `effectSchema`. |
| `Condition` | `engine/script/schema.ts` | A **predicate** — `flag`, `pool`, `hasItem`, `hasCondition`, `all`/`any`/`not`, `hook`. Read by a `branch`, a choice option's `available`, an ability's `available`. |
| `ConditionDef` | `engine/content/conditions.ts` | A **status on a creature** — `vulnerable`, `hidden`, `restrained`, `rooted`, `stunned`, `asleep`, `on-fire`, `tavas-armor`, `dodging`. Carries `modifiers`, `defenses`, `blocks` and `endsWhen`. Not the same thing as `Condition`; the two share only a word. |
| `CheckRequest` | `engine/script/schema.ts` | A roll and what each of the five outcomes does. Fallbacks in `effects.ts:outcomeEffects`. |
| `TargetSelector` | `engine/script/schema.ts` | `actor`, `party`, `entity`, `entities`, `target`, `hit`, `allies`, `adversaries`. |
| `CardDef` | `engine/content/pack/import.ts` | Anything a character has: `id`, `name`, `grant`, `text`, `features`, and for a chosen card `domain`, `type`, `level`, `recallCost` -- `DomainCardDef`, narrowed by `isDomainCard`. |
| `AbilityDef` | `engine/content/abilities.ts` | What a card does, or a stat-block feature: `id`, `name`, `source` (the card it sits on), `text`, `kind`, `trigger`, `cost`, `uses`, `target`, `available`, `inCombatOnly`, `action`, `effects`, `modifiers`, `defenses`, `standardAttack`, `reaction`, `tokens`, `auto`. |
| `DamageDefenses` | `engine/rules/damage.ts` | `resistances`, `immunities`, `reduce[]`. Its content-side mirror is `damageDefensesSchema` in `content/abilities.ts`, used by both an ability and a `ConditionDef`. |
| `IncomingDamage` | `engine/rules/damage.ts` | `amount`, `types`, `direct`. What arrives. |
| `ResolvedDamage` | `engine/rules/damage.ts` | `incoming`, `reduced`, `severity`, `finalSeverity`, `armorSlotsSpent`, `hpMarked`. What it came to. |
| `DamageThresholds` | `engine/rules/damage.ts` | `{ major, severe }`; `Infinity` means "None" on the stat block. |
| `AttackProfile` | `engine/combat/attack.ts` | The attacker's side: `kind` (`pc`/`adversary`), `name`, `modifier`, `range`, `damage`, `proficiency`, `direct`. |
| `DefenderProfile` | `engine/combat/attack.ts` | The target's side *as an attack sees it*: `difficulty`, `thresholds`, `defenses`. |
| `Defender` | `engine/combat/defense.ts` | The target's side *as a defence sees it*: `thresholds`, `defenses`, `armorSlots`, `stress`, `good`, `reactions`. Different type, different file, different job. |
| `AttackOutcome` | `engine/combat/attack.ts` | Everything one roll produced, including `refused`, `dualityRoll`/`gmRoll`, `damageRoll`, `damage`, and the Light/Shadow/spotlight movement. |
| `EntityState` | `engine/scene/state.ts` | A creature on the map: `id`, `faction`, `definition`, `tile`, `hitPoints`, `stress`, `armorSlots`, `good?`, `conditions`, `conditionDurations`, `alive`. |
| `SceneState` | `engine/scene/state.ts` | The whole runtime overlay, keyed by content id, plus the tile occupancy index and the GM's Shadow. Serialises through `sceneSnapshotSchema`. |
| `JournalEntry` | `engine/script/runner.ts` | One thing that happened, as a tagged union of ~30 variants. A UI renders these; a test asserts on them. |
| `Prompt` | `engine/script/runner.ts` | What the runner is waiting for: `choice`, `check` or `dialogue`. Answered with a `Response`. |
| `ProjectDoc` | `engine/scene/schema.ts` | The authored document, `formatVersion` 3. An older file is migrated on the way in (`scene/migrate.ts`); one from a newer build fails loudly. |
| `Rng` | `engine/core/rng.ts` | `next`, `nextInt`, `die`, `dice`, `pick`, `shuffle`, `fork`, `save`, `restore`. |

The document is immutable and the overlay is mutable. The legacy prototype wrote play state into its
content objects — `node.used`, `enemy.hp` — so a session could never be saved or restarted without
re-parsing the source JSON; here nothing in a `SceneDoc` ever changes.

### The project document

```
ProjectDoc
├─ formatVersion: 3        ├─ quests[]        ├─ code[]              (project JS, run as hooks)
├─ id, name                ├─ assets[]        ├─ conditionDefs[]     (ConditionDef)
├─ terrainPalette?         ├─ abilities[]     ├─ party[]             (CharacterSheet)
├─ scenes[]  (min 1)       ├─ items[]         ├─ adversaryModels{}   (type id -> model id)
├─ dialogues[]             ├─ lootTables[]    └─ startScene
│
├─ the content pack a character is built from, all defaulted:
│  classes[]  ancestries[]  communities[]  subclasses[]  cards[]  weapons[]  armors[]
│
└─ superRefine: duplicate scene ids, duplicate dialogue ids, cross-references
```

Almost every array is `.default([])`, deliberately: a project written before quests, abilities,
code, conditions, an authored party or its own content existed is still a valid project.

---

## 6. Invariants

Each of these exists because breaking it once already cost something.

**One effect and condition vocabulary — `src/engine/script/schema.ts` — and never a second.**
There were once two: a nine-variant union in `scene/schema.ts` that a document could hold, and the
full union in `effects.ts` that the runner could execute. Nothing converted between them, so an
interactable's authored check was imported, validated, saved and never run. `scene/schema.ts`,
`dialogue/schema.ts` and `content/abilities.ts` all import from `script/schema.ts` now. A converter
would be a second vocabulary to keep in step and the obvious place for the two to drift; add a
variant to the one union instead.

**The engine core stays headless.** No DOM, no WebGL, no `three`, no `preact` under `src/engine/**`
outside `render/`. It is what makes the rules testable in node, replayable, and runnable without a
browser. `tests/unit/engine-is-headless.test.ts` fails the build if it slips.

**Every roll comes from a seeded `Rng`; nothing in `src/engine/**` calls `Math.random()`.** A run is
reproducible from its seed, so a test pins an exact outcome and a save can restore the stream
position. Project code cannot escape it either: `script/hooks.ts` shadows `Math` with `SAFE_MATH`,
whose `random` throws *"Math.random is not available in a hook: roll off ctx.rng so replays stay in
step"*, and shadows `Date` so a stray `Date.now()` is a `TypeError` the author sees at once.

**Content ids are stable kebab or snake case; never rely on array order.**
`contentIdSchema` in `scene/primitives.ts` is `/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/`, and
`toContentId()` in `content/types.ts` normalises a display name to it. Array order changes
whenever someone reorders a list in the editor; an id does not.

**A project's content lays over its pack's by id, whole.** `mergePack` (`content/pack/import.ts`)
lays a project's lists over the pack's: an entry with a pack entry's id replaces it entirely -- not
a field-by-field merge -- and the pack's other entries survive. What a project places is what it
carries: a stat block brings no scripted feature with it unless a pack or the project prints one
on it.

**Importers never throw.** A broken entry is skipped and reported as a `ContentIssue`, so one typo
cannot take down a whole project. Anything arriving from outside the process — a save file,
`localStorage`, an imported project — parses through a zod schema at the door.

**Optional rules stay opt-in.** Massive Damage (`SeverityOptions.massiveDamage`) is off by default
because the SRD prints it as optional, and the critical-damage rule is a flag
(`criticalRule: 'maxDicePlusRoll' | 'doubleDice'`) because the community summary contradicts both
official versions. Neither becomes the default without a citation.

**`applyAttack` reports what actually happened, not what was asked for.** Light at its cap does not
accrue; a target with one Hit Point left marks one however severe the hit was. Anything that reads
the result reads the truth.

---

## 7. Recipes

Numbered, in order, with the real files. Each is derived from a commit that did exactly this.

### (a) Add an effect to the script vocabulary, end to end

Worked example: `loseGood`, engine side in commit `8c80bc2`, editor row in `d19c101`.

1. **`src/engine/script/schema.ts`** — add a variant to `effectSchema`'s discriminated union, with
   a doc comment saying what the SRD sentence is and how this departs from it. If it nests effects,
   use zod 4's getter form (`get onHit() { return z.array(effectSchema).optional(); }`) and add the
   descent to `walkEffects`; if it holds a condition, add it to `walkConditionsIn`. A validator that
   forgets to descend reports a clean bill of health for a broken file.
2. **`src/engine/script/runner.ts`** — three edits in this file:
   - a method on the `ScriptWorld` interface, if the effect needs the world to do something new
     (`loseGood(id: string, amount: number): number`);
   - a `JournalEntry` variant for what it did (`{ kind: 'goodLost'; lost: number; id: string }`);
   - a `case` in the `apply` switch (`runner.ts:549`). The switch has **no `default`**, and `apply`
     returns `Prompt | null`, so a missing case is a `tsc --noEmit` error — that is the check that a
     new variant was actually wired up.
3. **`src/engine/script/world.ts`** — implement the `ScriptWorld` method on `SceneScriptWorld`. It
   is the only writer of state; nothing else may reach into `EntityState`.
4. **`src/editor/ui/EffectList.tsx`** — add the kind to `ADDABLE`, a human label to the label map
   (`loseGood: 'Take their Light'`), a `case` in the row renderer and a `case` in the default-value
   builder. The panel shows what it cannot build rather than hiding it, so this step can lag the
   engine by a commit — but it must land, or the effect exists and nobody can author it.
5. **`src/editor/validate.ts`** — if the effect names content that must exist, or holds a string
   that must parse, report it there. The Check button says so while it is being written rather than
   when someone reaches for it.
6. **Tests.** `src/engine/script/runner.test.ts` for the stepper's handling,
   `src/engine/script/abilities.test.ts` for it inside a real card, `src/editor/ability-edits.test.ts`
   for the panel writing it, and `tests/e2e/demo.spec.ts` if a person has to be able to click it.
7. **Docs.** `docs/MANUAL.md` gains the row in the effect table. If the effect lets a previously
   text-only SRD feature be scripted, rerun the relevant generator.


**A second worked example, and the most recent.** `attack.joinedBy`, with `sameKind` on the
`adversaries` selector, commit `058c3af`: a Minion swarm walks into reach and swings on one roll,
the damage counted once for each body standing there when it lands. It is a *field on an existing
effect* rather than a new kind, so there is no new `case` in the switch and no new `JournalEntry`;
it went `schema.ts` → `runner.ts` → `world.ts` → `EffectList.tsx` → tests →
`python tools/adversaries-doc.py`, which is steps 1, 2, 3, 4, 6 and 7 above, in order. Step 5 was
skipped because the field names no content that has to exist. One field scripted Group Attack on
sixteen stat blocks, which is the shape to aim for: a feature printed many times with one number
changed is one field, not sixteen entries.

### (b) Add a field to `AbilityDef`

Worked example: `defenses.reduce`, commit `6ec74ef` — "a number off the damage before the bands".

1. **Decide where it is read first; that decides the design.** A PC's swing at an adversary is
   resolved in `resolveAttack` and applied at once, with no defence step to catch it. So reduction
   went into `DamageDefenses` and `resolveDamage` does the flat half itself, which reaches every
   path damage takes without asking a caller for anything.
2. **`src/engine/rules/damage.ts`** — the rule. `DamageReduction`, `flatReduction`,
   `reductionRolls`, `rollReduction`, `ResolveDamageOptions.rolledReduction`, and the arithmetic in
   `resolveDamage`. Comment the order you picked and why (resistance halves first, the number comes
   off what is left; no SRD block has both, so the order was ours to choose).
3. **`src/engine/content/abilities.ts`** — the content side: the field on `damageDefensesSchema`,
   with the SRD sentence it answers in the comment.
4. **`src/engine/combat/attack.ts`** — roll the dice half once per swing and hand it to
   `resolveDamage`.
5. **`src/engine/combat/defense.ts`** — the same, once per hit, in `resolveDefense` and
   `resolveDefensePlan`; and make `previewPlan` return `null` when an honest answer would need dice.
6. **`src/engine/script/world.ts`** — collect the field off everything the creature holds
   (`defensesOf` reads passives *and* active conditions; resistances and immunities dedupe,
   `reduce` entries stack).
7. **`src/game/demo-scene.ts`** — report it. A hit for 11 that marks nothing looks like a bug
   otherwise, so `reduced` travels into the log on every path damage takes.
8. **`src/editor/ui/AbilityPanel.tsx`** — a row for it (`data-testid="ability-reduce"`,
   `ability-reduce-type`).
9. **`src/editor/validate.ts`** — refuse what would silently do nothing. Here: a reduction that is
   not dice, and a reduction whose modifier is negative (`"1d10-2"` would hand the attacker two
   damage back).
10. **`tests/fixtures/adversary-features.ts`** — a specimen that carries it, printed on a block with
    `printed(blocks, feature)`: here `PLATE_THAT_TURNS_A_FLAT_AMOUNT` and
    `PLATE_THAT_ROLLS_WHAT_IT_TURNS`, which two test files play.
11. **Tests:** `rules/damage.test.ts`, `combat/defense.test.ts`, `editor/validate.test.ts`,
    `editor/authored-scenario.test.ts`, and a line in `tests/e2e/demo.spec.ts`.
12. **The prose** in `docs/MANUAL.md` and `docs/CRPG-GAPS.md`.

### (c) Script a stat block's feature

A stat block's feature is content, not engine code: the engine ships none -- the starter pack's
creatures carry printed traits only -- and a pack or a project brings its own.

1. **Trait or feature?** Relentless, Horde, Minion, Momentum and Terrifying are read structurally
   off the block (`combat/adversary-features.ts`, `IMPLEMENTED_FEATURES`): a trait belongs there,
   as a rule the fight obeys. Anything the GM *plays* -- an action, a reaction, a passive on the
   block's numbers -- is a feature, and is scripted.
2. **A card printed on the block, and the ability on it.** In the project's (or the pack's)
   `cards`, `{ id, name, grant: { kind: 'adversary', adversaries: ['<block-id>'] } }`; in
   `abilities`, the feature with `source: { card: '<that id>' }`, `text` as printed, `kind`, `cost`
   (Shadow is the GM's pool), `target`, `inCombatOnly`, and `effects` in the one vocabulary. In
   the editor: write it in the Cards panel and set **granted by** to stat blocks. **Comment every
   departure from the printed text** next to the thing that departs.
3. If the vocabulary cannot say it, add an effect (recipe a) or a native hook in
   `src/engine/script/native-hooks.ts` -- and if you do neither, leave the feature as text for the
   GM to narrate. An unscripted feature is honest; a half-scripted one is not.
4. **`src/editor/validate.ts`** already knows what only a stat block may do -- spend Shadow, hand
   out the spotlight, count the Hit Points its owner marks -- and what only the party's own swing
   obeys. `isStatBlockFeature` asks the cards; a new rule of that kind asks the same question.
5. **Test it on a fixture block.** Write the feature once, in `tests/fixtures/adversary-features.ts`
   or beside the one test that reads it, and print it with `printed(blocks, feature)`;
   `print(project, ...)` lays card and ability into a project. Play it in
   `src/editor/authored-scenario.test.ts` or `src/engine/script/abilities.test.ts` and assert on
   the journal.

### (d) Add a condition (a status on a creature)

There is no editor panel for `conditionDefs` — a project can carry them in its JSON, and the shipped
ones are code. So this is an engine change plus validation.

1. **`src/engine/content/conditions.ts`** — add an entry to `RAW`: `id` (kebab), `name`, `text`
   as printed, and then whichever of `modifiers`, `defenses`, `blocks` (`act` / `move` /
   `reactions`) and `endsWhen` (`hit` / `attacks` / `damaged`) it needs. `SRD_CONDITIONS` parses
   `RAW` through `conditionDefSchema`, so a malformed entry fails at import.
2. **Only if the attack roll itself must change:** `src/engine/combat/attack.ts:conditionModifiers`.
   It hard-codes exactly two — `vulnerable` gives advantage against the bearer, `hidden` gives
   disadvantage — because those are the two the SRD puts on the roll. Everything else a condition
   does belongs in `modifiers` or `defenses`, which `world.modifiersOf` and `world.defensesOf` read.
3. **`src/engine/script/world.ts`** — nothing, normally. `applyCondition`, `clearCondition`,
   `blocks`, `endsOnHit`, `endsOnAttack` and `endsOnDamage` are already generic over the definition.
4. **Duration.** A script applies it with `{ kind: 'applyCondition', condition, duration }` where
   duration is `temporary` | `scene` | `rest` | `permanent`. A `temporary` condition on the party is
   cleared once per GM turn inside `playGmTurn`, past its guards, so it happens however the
   spotlight passed. A beneficial condition must therefore be `scene` or `rest`, never `temporary`.
5. **`src/editor/validate.ts`** — condition ids named by an effect are checked against
   `project.conditionDefs` (`validate.ts:169`, `:240`); a new shipped condition needs nothing, a new
   *field* on `ConditionDef` may.
6. **Tests:** `src/engine/script/conditions.test.ts` and `src/engine/script/abilities.test.ts`.

---

## 8. Testing

**Where a test goes.** Co-located `*.test.ts` next to the module is the default — every module ships
with one. `tests/unit/` is for tests *about the repository* rather than about a module: the headless
guard, the whole-SRD import check, the demo scene, the demo fight, the legacy campaign import, and
`spike.test.ts`, which asserts three.js resolves as ESM under Vitest.
`tests/e2e/demo.spec.ts` is for anything that needs a browser, a canvas or a click.

```
npm test                       # vitest run — 70 files, 1205 tests, ~6s
npx vitest run <path>          # one file, while working
npm run typecheck              # tsc --noEmit — the only static check there is
npm run test:e2e               # playwright, 52 tests in one file; slow
npm run check                  # all three
```

Vitest's `include` is `tests/unit/**/*.test.{ts,tsx}` and `src/**/*.test.{ts,tsx}`, environment
`node`, `globals: false` — import `describe`, `it` and `expect` from `vitest` explicitly.
`happy-dom` is available for a DOM test but is not the default.

**Seeded-RNG discipline.** Never `Math.random()`, and never a bare `createRng()` where the outcome
matters. Either pin a seed (`createRng('demo')`) or hand the rule a scripted double. The double is
declared **locally in each test file that needs it**, not shared — as `scriptedRng(faces)` in
`combat/attack.test.ts`, `rules/duality.test.ts`, `rules/gm-die.test.ts`, `script/runner.test.ts`
and `dialogue/dialogue.test.ts`, and as `scripted(values)` in `combat/defense.test.ts` and
`script/abilities.test.ts`. It returns the given faces in order and throws
`scriptedRng exhausted after N draws` when over-consumed — which is itself an assertion: a test that
hands the runner exactly one die proves the code rolls it exactly once. `c9fdecc` used that to prove
the script `attack` path does not roll a defender's reduction twice.

Other per-file helpers by the same convention: `scene(seed)` wrapping `buildDemoScene`, and
`standoff(seed)` in `src/game/demo-defense.test.ts`, which builds a fight already holding a pending
defence prompt.

**The e2e handle.** `window.__engine` is built inline in `src/main.ts` and assigned at `:1565`.
It exposes the state a test cannot get at through the DOM: `frames`, `webgl2`, `errors`, `tiles`,
`entities`, `decos`, `missingModels()`, `party()`, `selected()`, `select(id)`, `selectNext()`,
`tileOf(id)`, `inCombat()`, `round()`, `adversaries()`, `hitPoints(id)`, `moveTo(tile)`,
`attack(id)`, `endGmTurn()`, `highlighted()`, `reachable()`, `sample(x, y)` (which re-renders inside
the same task, because the drawing buffer is not preserved between frames), `setMode`,
`exportProject`. A spec waits on `(window.__engine?.frames ?? 0) > 5` before touching anything.

**Selectors.** `data-testid` is kebab-case prefixed by the owning panel: `ability-name`,
`item-kind`, `code-source`, `check-difficulty`. Actions are `add-<thing>`, `open-<panel>`,
`close-<panel>`. Row ids interpolate the content id. There are 124 of them across the panels. Prefer
a testid over a text selector for anything the copy might change, and `getByRole('button', { name })`
for anything a player reads.

**A regression test must be shown to fail without its fix.** Writing the test after the fix is not
enough — a test that passes both ways proves nothing. The procedure: revert the fix (stash it,
comment the line, `git checkout` the file), run the test, watch it fail with the message you expect,
restore the fix, run again. Then say so in the commit message, naming which way it fails. `6ec74ef`
records that its content test fails *both* ways — without the roll in `resolveAttack` the dice half
does nothing, and without `defensesOf` collecting the field the flat half never reaches the
defender.

---

## 9. The working loop

**A slice** is one behaviour, complete: the rule, the content that uses it, the editor field that
writes it, the validation that refuses it when it is wrong, the tests that pin it, and the docs that
describe it. Not a layer at a time. Look at `6ec74ef` — eighteen files, one sentence of rules.
A slice that adds an engine capability with no way to author it, or a panel field nothing reads, is
half a slice and will be finished by someone with less context.

**Every commit carries a verification line**, in the body, stating what was run and what came back:

> `npx tsc --noEmit` clean, 1205 unit tests across 70 files and 52 e2e pass.

Then a sentence on how the new tests were shown to fail without their fix. If something could not be
verified, say that instead of implying it works.

**Commit messages** are a sentence about the behaviour, not the files: *"Let a stat block wear plate:
a number off the damage before the bands"*. The body explains the design decision and why the
alternative was rejected. The trailer:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YW7ZQM2cmKNB9XJAbtx69u
```

**Review, then follow up.** A slice lands, a review reads it, and what the review found lands as its
own commit that says so — `c9fdecc` opens "Follow-up to the reduction slice, from review". Three of
the last four commits are that pattern. Do not amend the reviewed commit; the pair is the record.

---

## 10. Content and licensing

### Content packs

A **pack** is the lists a character is built from — classes, ancestries, communities, subclasses,
cards, weapons and armors — and the stat blocks they are set against. `content/pack/schema.ts` says
what one is and `content/pack/document.ts` reads one from a file. Nothing about the engine knows
which catalogue it is reading: `character/sheet.ts` takes a `ContentPack` as a parameter.

**Everything a character has is a card.** A card's `grant` says how it came to be in play -- `chosen`
into a loadout, or granted by a class, a subclass stage, an ancestry, a community, or a project
handing it to named characters -- and an ability sits on a card by id (`source: { card }`), in play
when its card is. Nothing lists a class's cards: each card names what grants it, so a pack of extra
cards for somebody else's class imports without editing the class. `deriveCharacter` works out
`DerivedCharacter.granted` for the numbers; the world and the action bar recompute it from the cards
as they stand each time they read (`grantedCards`), so a card handed over mid-scene is in hand at
once.

A project may carry its own pack in the seven `ProjectDoc` fields above, exactly as it already
carries its abilities, items and conditions. An empty list means "whatever pack the app was given".

**Importing one.** Project ▾ → Import pack… reads a pack *file* — `packDocumentSchema`: those lists
plus `adversaries`, `abilities` and `conditionDefs` — through `readPack`, and `importPack` lays it
into the same project fields by id, replacing a same-id entry where it stands and appending the
rest, as one undo step. It is not a load; nothing the game is running is replaced. The lists are
changed **in place**, because the script world holds `project.abilities` by reference.

Two shapes are named for what they are rather than for a rule: a class's `signatureFeature` (the
feature it grants for its own resource), and armor thresholds, which must be finite integers because
`NO_THRESHOLDS` uses `Infinity` and `JSON.stringify` writes that as `null`.

### Where content comes from

Nothing is vendored. The engine ships its own starter pack (`content/pack/starter*.ts`), nobody
else's content, and reads anything else as a pack a user imports (Project ▾ → Import pack…,
`content/pack/document.ts`). The SRD catalogue this repository once carried was exported before it
was deleted; `docs/CONTEXT.md` says where, and why the export is git-ignored.

**Rules come from the SRD 2.0 text, as settled while it was here.** The section-by-section diff
against 1.0 is recorded in `docs/CONTEXT.md`, which is now the reference for what the engine
implements and why. One number is a choice the engine exposes rather than a quotation: critical
damage adds the dice's maximum, as both SRD versions say, and a table that doubles the dice
instead can set `criticalRule: 'doubleDice'` -- `rules/damage.ts` says so above the flag.

**Both attributions must survive.** The SRD 2.0 DPCGL attribution and the SRD 1.0 one that the
community sets carry are separate obligations and both are kept — the exact 2.0 wording is in
`docs/CONTEXT.md`, which is now the only place that wording lives — the per-source READMEs went
with the sources they described.
Daggerheart is a trademark of Critical Role, LLC; this project is unaffiliated.

**Sources.** The source PDF was never committed, and the text extracted from it went with the
catalogue.
**Card art is generated, not sourced.** `ui/card-sigil.ts` draws each domain card's emblem from
its own id, seeded through `createRng`, so nothing in `src/` reads an image file and the licence
question never arises. `ui/card-art.ts` then layers two optional sources over it: a file named in
`public/cards/index.json`, and art a player imported into their own browser, which wins. **A URL
is only ever built from that index** — a guessed `/cards/<id>.jpg` would 404 for every card
without a file, and `tests/unit/licensing-boundary.test.ts` fails if any source interpolates one.
`tools/index-card-art.mjs` writes the index by listing the directory; it downloads nothing. The
scraper that used to fill that directory was removed on 2026-09-10, and `public/cards/` is
git-ignored because what is in it today is Critical Role's artwork, which the DPCGL does not
cover. See `AGENTS.md`.

**Distribution is guarded separately from Git.** `tools/build-public-assets.ts` disables Vite's
automatic public-directory copy, emits other regular public files, excludes the entire `cards`
subtree, and emits an empty index where `public/cards/index.json` would go. Local directory art
remains available in dev;
production uses generated emblems and per-browser imports. `card-art-packaging.test.ts` builds
a fixture with private nested images to verify the output, and exercises mixed-case extensions
through the real indexer. `CardArtwork` falls back on decode/load errors and resets the attempt
when the source changes; browser tests cover broken directory art, corrupt imports and replacement.

---

## 11. Gotchas

- **The repository path contains a space.** Quote it everywhere. The repo has moved between
  machines before: prefer repo-relative paths in code, scripts and docs, and never hardcode a path
  or a home directory.
- **`legacy/` is never modified.** It is the original prototype, kept runnable via
  `legacy/start.bat`. It also serves on port 8420, so do not run it and `npm run dev` at once. Read
  `docs/research/legacy-*.md` instead of the sources.
- **Ports.** Vite dev and preview on `127.0.0.1:8420`; Playwright starts its own on 8421 with
  `--strictPort`, and reuses an existing server if one is already there.
- **There is no lint and no format tooling.** No ESLint, no Prettier. `npx tsc --noEmit` is the only
  static check, and it is `strict` with `noImplicitOverride`, `noFallthroughCasesInSwitch` and
  `isolatedModules`. Match the surrounding style by reading it.
- **`grep` sees some sources as binary.** `src/game/demo-scene.ts` among them (an em dash in a
  comment). Pass `grep -a`, or the match count comes back as "Binary file … matches".
- **Path aliases:** `@engine/*`, `@editor/*`, `@game/*` resolve to their source directories;
  `@content/*` resolves to `src/engine/content/*` in both TypeScript and Vite.
- **`fflate` is a dependency and is imported nowhere under `src/`.** `CONTEXT.md`'s "zip import and
  export of projects with assets" is not implemented; export is `JSON.stringify` into a `Blob`.
- **Construction has bounded LOD; legacy ground and props still need it.** `building-view.ts`
  indexes 16³ chunks, queries nearby columns, frustum-culls, and retains at most 96 chunks within
  128 world units of their bounding spheres. It builds at most two chunks per frame. LOD switches
  at 24/64 units with four-unit hysteresis: rounded boxes, plain boxes, then simplified stairs.
  Instance transforms stay chunk-local for distant-coordinate precision; empty coordinates are
  never materialized. `sync(scene)` compares tile references and preserves unchanged buffers.
  Authoring replaces a touched tile object through `BuildingEdit`; never mutate it in place.
  Idle cameras skip chunk selection. `buildingStats()` reports actual resident geometry budgets.
  CPU document/index memory scales with placed pieces; GPU residency is bounded. The sparse layer
  does not alter the dense tactical grid or implement collision/navigation.
  Building keys may include `#instance` to retain overlaps. Z remains named `level` for compatibility
  and supports quarter tiles; optional `height` scales pieces vertically. Bounds include tall pieces.
  `SceneView.setAuthoring` renders document creatures separately from runtime tokens;
  `syncAuthoredEncounters` reconciles the cast on every scene entry against `DemoScene.syncedPlacements`,
  not against the state, so a creature a script removed is not resurrected by a trip to the editor.
  A remote/elevated placement is not yet a multilevel nav node, and never enters play.
- **Two vertical units coexist until part 2 unifies them: `heights[]` counts levels of
  `levelHeight` (0.35), while `buildingTiles.level` and `position.z` count tiles. Nothing may
  convert between them into saved content.** A renderer constant in a document is a document that
  means something different the day the constant changes.
- **No TTS, no speech synthesis, no "voice" features.** A hard constraint from the user; both
  attempts were removed.
- **All content text is English.**
