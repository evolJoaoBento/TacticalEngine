# PolyHeart Engine — Developer Guide

For whoever picks up work in this repository next, human or agent. It says where things are,
which way they point, what may not be broken, and the order to touch files in for the changes
that keep recurring. It is a reference to look things up in, not a tutorial to read through.

**Which doc covers what.** Three files, no overlap:

| Doc | Covers |
|---|---|
| `docs/CONTEXT.md` (122 lines) | The goal, the hard constraints, the chosen stack, the SRD sourcing and the house rules. Read it first; it is the working agreement. |
| `docs/MANUAL.md` (922 lines) | Playing the demo and authoring content in the editor. Every panel, every field, every verb. Hand-written, user-facing. |
| **this file** | Extending the engine: adding an effect, a condition, a passive, a panel field, an SRD feature, a rule. |

Two further docs are *generated* and must never be hand-edited: `docs/ADVERSARIES.md` (470 lines,
`python tools/adversaries-doc.py`) and `docs/CARDS.md` (257 lines, `python tools/cards-doc.py`).
`docs/CRPG-GAPS.md` (491 lines) is an honest audit against the CRPG goal — read it before claiming
a system exists. `docs/research/legacy-{game,campaign,editor-ui,models}.md` are static-analysis
notes on the legacy prototype with `file:line` anchors; read those instead of re-reading `legacy/`.

The same page arranged for reading rather than lookup is `docs/developer-guide.html` — open it from
`file://`, it fetches nothing.

**Line counts and `file:line` anchors below are as of commit `058c3af`, the current HEAD.**
A working tree part-way through a slice moves them; the symbol name is the stable handle, and
`grep -a` finds it.

---

## 1. Orientation

PolyHeart is a browser CRPG engine and editor running the Daggerheart SRD 2.0 rules. A *project* is
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
6. `src/main.ts` (1578 lines) — the boot path and the only DOM listeners in the project.

### The layer map

```
  the page        src/main.ts   ·  engine/render/  ·  editor/ui/  ·  window.__polyheart
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
| `rules/duality.ts` | `rollDuality` — a PC's two dice, the five outcomes, Hope/Fear/spotlight. |
| `rules/gm-die.ts` | `rollGmDie` — the GM's single d20 against Evasion, natural-20 crit. |
| `rules/damage.ts` | Thresholds, severity bands, Armor Slots, resistance/immunity/reduction, `rollDamage`, `resolveDamage`. |
| `rules/countdown.ts` | The clock: `advanceCountdown`, `stepsFor`, `dynamicSteps` (the SRD's progress/consequence chart), loops. No effects, no rng. |
| `rules/cover.ts` | SRD 2.0 cover: a partial obstruction costs the attacker a disadvantage die. |
| `rules/range.ts` | `RANGE_BANDS`, `DEFAULT_BAND_TILES` (a house rule — see CONTEXT.md). |
| `rules/resources.ts` | `MarkPool` and `Currency`: Hit Points, Stress, Armor Slots, Hope, Fear; `mark`, `unmarked`, `canAfford`, `markHitPoints`. |
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
| `script/world.ts` | `SceneScriptWorld` — the only writer of scene state (1330 lines). `ScenarioState`, `worldOptions`' counterpart types. Movement lives here too: `drawIn` walks a creature towards another until it is within a band, `breakAway` walks it as far off as it can get, both inside a budget and both refused while something holds it. |
| `script/countdowns.ts` | The board a scenario carries: `RunningCountdown` (a clock plus what it is counting towards), `advanceBoard`, `reapBoard`, `endCreatureCountdowns`, and the snapshot schema a save uses. |
| `script/hooks.ts` | Running project code: `HookContext`, `runHook`, `SAFE_MATH`. |
| `content/types.ts` | `AdversaryDef`, `AdversaryFeature`, `ContentIssue`, `ImportResult`, `toContentId`. |
| `content/abilities.ts` | `AbilityDef` and its sub-schemas; `abilitiesFor`, `loadoutOf`, `isScripted`, `isAutomatic`, `readsATarget`. A modifier's `advantage` stat is a signed count of dice, `against: true` puts it on rolls made at the holder, `plusProficiency` adds their Proficiency, and `perToken` multiplies the whole bonus by the tokens on a card — never folded into a derived character, because tokens are scene state. A passive's `standardAttack` changes the block's own swing (`direct`, `damage`, `double`), with `when` read from the attacker's chair and the target bound. `target.when` says what makes a creature worth aiming at, read once per candidate by both the player's list and the GM's. |
| `content/conditions.ts` | `ConditionDef` — what a *status* on a creature does. `SRD_CONDITIONS`. |
| `content/items.ts`, `content/quests.ts` | Item and quest content shapes. |
| `content/srd/daggersearch.ts` | Normalises the vendored SRD 1.0 character data (470 lines). |
| `content/srd/seansbox-adversaries.ts` | Normalises the 129 stringly-typed adversaries (300 lines). |
| `content/srd/abilities.ts` | `SRD_ABILITIES`, `SRD_ABILITY_MAP` — hand-written domain cards (1131 lines). |
| `content/srd/adversary-abilities.ts` | `SRD_ADVERSARY_ABILITIES` — hand-written stat-block features (1556 lines). |
| `content/srd/hooks.ts` | `SRD_HOOKS` — native hooks for what the vocabulary cannot say. |
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
| `render/terrain-mesh.ts` | One `InstancedMesh` per terrain type. |
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
| `validate.ts` | The **Check** button (653 lines). Reports playability problems a zod parse cannot: party, abilities, code, item uses, quests, then per scene the spawns, interactables, decos, encounters, reachability (pathfinding, run last because it is the expensive one), loot tables and dialogues. |
| `ui/EffectList.tsx` | The largest panel (930 lines): editing a list of effects, recursively. `ADDABLE` is the list of kinds it can build. |
| `ui/AbilityPanel.tsx` | An ability's fields, including `defenses` and `tokens`. |
| `ui/ConditionEditor.tsx`, `ui/CheckEditor.tsx`, `ui/TargetEditor.tsx` | The three sub-editors `EffectList` nests. |
| `ui/EditorPanel.tsx` | The editor shell and tool palette. |
| `ui/Inspector.tsx`, `ui/DialogueGraph.tsx`, `ui/ItemPanel.tsx`, `ui/PartyPanel.tsx`, `ui/QuestEditor.tsx`, `ui/CodePanel.tsx` | The rest of the panels. |

`src/main.ts` is the boot path and the only file with DOM listeners. `index.html` holds a
`<canvas id="gl">` and a `<div id="app">` and loads `/src/main.ts`.

### `tests/`, `tools/`

`tests/unit/` holds the six tests that are about the repository rather than a module:
`engine-is-headless.test.ts`, `srd-content-strings.test.ts`, `demo-scene.test.ts`,
`demo-map-fight.test.ts`, `legacy-campaign-import.test.ts`, `spike.test.ts`. `tests/e2e/demo.spec.ts`
is the only Playwright file. `tests/fixtures/models/` holds `BoxTextured.glb`, `Duck.glb`, `Fox.glb`.

`tools/` holds exactly two Python scripts — `adversaries-doc.py` and `cards-doc.py` — plus the
vendored `tools/srd-sources/` tree. They are not npm scripts; run them from the repo root with
`python tools/adversaries-doc.py`.

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
8. `window.__polyheart = state` (built inline, `src/main.ts:1198`–`1565`; assigned at `:1565`).
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
       ├─ rollDuality (rules/duality.ts)              — hit, crit, Hope, Fear, spotlight
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
with a price — "you can spend 2 Hope to…" — is put to the player as a third kind of
`demo.pending`, a `PendingReaction`, whose first option is always letting it pass. The line
between the two is `auto && no cost`: a card that would be asked about anyway sets `auto: false`.
A swing at somebody also raises `attacked` on them, hit or miss, which is how a bonus that lasts
"until after the next attack made against you" knows when it is over. A roll the *party* makes
raises `partyRolled` on every adversary standing: the one who rolled is bound as the target, so
the distance is a plain `withinRange`, and what the dice said is a `rolled` condition — the five
readings (`failure`, `success`, `withFear`, `withHope`, `critical`) compose, so "a failure with
Fear" is an `all` of two. The same
happens on the party's own swing: `playAttackRiders` reads `dealtHit` and `dealtDamage` for
whoever swung, so Healing Strike is offered after a player's attack the way a stat block's rider
runs after the GM's. Every note is read before anyone is asked, because `drainDamage` clears as
it reports; what is not asked now is queued behind the question that is up.

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
| `AbilityDef` | `engine/content/abilities.ts` | A card, a class feature or a stat-block feature: `id`, `name`, `source`, `text`, `kind`, `trigger`, `cost`, `uses`, `target`, `available`, `inCombatOnly`, `action`, `effects`, `modifiers`, `defenses`, `standardAttack`, `reaction`, `tokens`, `auto`. |
| `DamageDefenses` | `engine/rules/damage.ts` | `resistances`, `immunities`, `reduce[]`. Its content-side mirror is `damageDefensesSchema` in `content/abilities.ts`, used by both an ability and a `ConditionDef`. |
| `IncomingDamage` | `engine/rules/damage.ts` | `amount`, `types`, `direct`. What arrives. |
| `ResolvedDamage` | `engine/rules/damage.ts` | `incoming`, `reduced`, `severity`, `finalSeverity`, `armorSlotsSpent`, `hpMarked`. What it came to. |
| `DamageThresholds` | `engine/rules/damage.ts` | `{ major, severe }`; `Infinity` means "None" on the stat block. |
| `AttackProfile` | `engine/combat/attack.ts` | The attacker's side: `kind` (`pc`/`adversary`), `name`, `modifier`, `range`, `damage`, `proficiency`, `direct`. |
| `DefenderProfile` | `engine/combat/attack.ts` | The target's side *as an attack sees it*: `difficulty`, `thresholds`, `defenses`. |
| `Defender` | `engine/combat/defense.ts` | The target's side *as a defence sees it*: `thresholds`, `defenses`, `armorSlots`, `stress`, `hope`, `reactions`. Different type, different file, different job. |
| `AttackOutcome` | `engine/combat/attack.ts` | Everything one roll produced, including `refused`, `dualityRoll`/`gmRoll`, `damageRoll`, `damage`, and the Hope/Fear/spotlight movement. |
| `EntityState` | `engine/scene/state.ts` | A creature on the map: `id`, `faction`, `definition`, `tile`, `hitPoints`, `stress`, `armorSlots`, `hope?`, `conditions`, `conditionDurations`, `alive`. |
| `SceneState` | `engine/scene/state.ts` | The whole runtime overlay, keyed by content id, plus the tile occupancy index and the GM's Fear. Serialises through `sceneSnapshotSchema`. |
| `JournalEntry` | `engine/script/runner.ts` | One thing that happened, as a tagged union of ~30 variants. A UI renders these; a test asserts on them. |
| `Prompt` | `engine/script/runner.ts` | What the runner is waiting for: `choice`, `check` or `dialogue`. Answered with a `Response`. |
| `ProjectDoc` | `engine/scene/schema.ts` | The authored document. `formatVersion` is a literal `1`, so an old file fails loudly. |
| `Rng` | `engine/core/rng.ts` | `next`, `nextInt`, `die`, `dice`, `pick`, `shuffle`, `fork`, `save`, `restore`. |

The document is immutable and the overlay is mutable. The legacy prototype wrote play state into its
content objects — `node.used`, `enemy.hp` — so a session could never be saved or restarted without
re-parsing the source JSON; here nothing in a `SceneDoc` ever changes.

### The project document

```
ProjectDoc
├─ formatVersion: 1        ├─ quests[]        ├─ code[]              (project JS, run as hooks)
├─ id, name                ├─ assets[]        ├─ conditionDefs[]     (ConditionDef)
├─ terrainPalette?         ├─ abilities[]     ├─ party[]             (CharacterSheet)
├─ scenes[]  (min 1)       ├─ items[]         └─ startScene
├─ dialogues[]             ├─ lootTables[]
└─ superRefine: duplicate scene ids, duplicate dialogue ids, cross-references
```

Almost every array is `.default([])`, deliberately: a project written before quests, abilities,
code, conditions or an authored party existed is still a valid project.

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
`toContentId()` in `content/types.ts` normalises a display name to it. Both Python doc generators
reimplement the same transform so a doc anchor matches a runtime id. Array order changes whenever
someone reorders a list in the editor; an id does not.

**A project ability with the same id overrides an SRD one, whole.**
`withStatBlockFeatures` in `src/game/demo-scene.ts:438` is
`[...abilities, ...SRD_ADVERSARY_ABILITIES.filter(f => !own.has(f.id))]`. A campaign that places an
Acid Burrower has not written Spit Acid — the SRD did, and the engine ships it — so the shipped
features are always there unless a project says something different with the same id. The override
replaces the definition entirely; it is not a field-by-field merge.

**Importers never throw.** A broken entry is skipped and reported as a `ContentIssue`, so one typo
cannot take down a whole project. Anything arriving from outside the process — a save file,
`localStorage`, an imported project — parses through a zod schema at the door.

**Generated docs are regenerated, never hand-edited.** `docs/ADVERSARIES.md` and `docs/CARDS.md`
come from `python tools/adversaries-doc.py` and `python tools/cards-doc.py`. Both scripts read the
vendored SRD JSON *and* the engine's own `.ts` content files, so a generated doc cannot claim more
than the code does. `adversaries-doc.py` regexes on the literal name `IMPLEMENTED_FEATURES` in
`combat/adversary-features.ts` and on the `id:`/`name:`/`source: from(...)` shape of
`adversary-abilities.ts`: renaming either breaks the generator silently.

**Optional rules stay opt-in.** Massive Damage (`SeverityOptions.massiveDamage`) is off by default
because the SRD prints it as optional, and the critical-damage rule is a flag
(`criticalRule: 'maxDicePlusRoll' | 'doubleDice'`) because the community summary contradicts both
official versions. Neither becomes the default without a citation.

**`applyAttack` reports what actually happened, not what was asked for.** Hope at its cap does not
accrue; a target with one Hit Point left marks one however severe the hit was. Anything that reads
the result reads the truth.

---

## 7. Recipes

Numbered, in order, with the real files. Each is derived from a commit that did exactly this.

### (a) Add an effect to the script vocabulary, end to end

Worked example: `loseHope`, engine side in commit `8c80bc2`, editor row in `d19c101`.

1. **`src/engine/script/schema.ts`** — add a variant to `effectSchema`'s discriminated union, with
   a doc comment saying what the SRD sentence is and how this departs from it. If it nests effects,
   use zod 4's getter form (`get onHit() { return z.array(effectSchema).optional(); }`) and add the
   descent to `walkEffects`; if it holds a condition, add it to `walkConditionsIn`. A validator that
   forgets to descend reports a clean bill of health for a broken file.
2. **`src/engine/script/runner.ts`** — three edits in this file:
   - a method on the `ScriptWorld` interface, if the effect needs the world to do something new
     (`loseHope(id: string, amount: number): number`);
   - a `JournalEntry` variant for what it did (`{ kind: 'hopeLost'; lost: number; id: string }`);
   - a `case` in the `apply` switch (`runner.ts:549`). The switch has **no `default`**, and `apply`
     returns `Prompt | null`, so a missing case is a `tsc --noEmit` error — that is the check that a
     new variant was actually wired up.
3. **`src/engine/script/world.ts`** — implement the `ScriptWorld` method on `SceneScriptWorld`. It
   is the only writer of state; nothing else may reach into `EntityState`.
4. **`src/editor/ui/EffectList.tsx`** — add the kind to `ADDABLE`, a human label to the label map
   (`loseHope: 'Take their Hope'`), a `case` in the row renderer and a `case` in the default-value
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
10. **`src/engine/content/srd/adversary-abilities.ts`** — the features that now have a home
    (Heavily Armored, Immovable Object, Faltering Armor, Firespite Plate Armor, Unreal Form).
11. **Tests:** `rules/damage.test.ts`, `combat/defense.test.ts`, `editor/validate.test.ts`,
    `editor/authored-scenario.test.ts`, and a line in `tests/e2e/demo.spec.ts`.
12. **`python tools/adversaries-doc.py`**, then the prose in `docs/MANUAL.md` and
    `docs/CRPG-GAPS.md`.

### (c) Script an SRD adversary feature

1. **Read the printed text.** `docs/ADVERSARIES.md` lists every feature and its state — **read**
   (a rule the fight obeys, from `combat/adversary-features.ts`), **scripted**, or **text**. Pick
   from the text list; the doc also names why each one is still text.
2. **Quote the rule from the official source.** `tools/srd-sources/official-2.0/srd-2.0.txt` only.
   The community JSON is content, never a rule.
3. **`src/engine/content/srd/adversary-abilities.ts`** — add an entry to `RAW`:
   `id` (`<adversary-id>-<feature-kebab>`), `name`, `source: from('adversary-id', ...)`, `text`
   verbatim, `kind`, `cost`, `target`, `inCombatOnly`, and `effects` in the one vocabulary.
   **Comment every departure from the printed text**, in the entry, next to the thing that departs.
4. If the vocabulary cannot say it, either add an effect (recipe a) or a native hook in
   `src/engine/content/srd/hooks.ts` — and if you do neither, leave the feature as text and let the
   generated doc say so.
5. **`src/engine/content/srd/library.test.ts`** — the whole-library sanity check runs over the new
   entry automatically; add a case for anything specific.
6. **`src/engine/script/abilities.test.ts`** — play the feature against a real world and assert on
   the journal.
7. **`python tools/adversaries-doc.py`.** The counts at the top of `docs/ADVERSARIES.md` move on
   their own; do not type them.

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

**The e2e handle.** `window.__polyheart` is built inline in `src/main.ts` and assigned at `:1565`.
It exposes the state a test cannot get at through the DOM: `frames`, `webgl2`, `errors`, `tiles`,
`entities`, `decos`, `missingModels()`, `party()`, `selected()`, `select(id)`, `selectNext()`,
`tileOf(id)`, `inCombat()`, `round()`, `adversaries()`, `hitPoints(id)`, `moveTo(tile)`,
`attack(id)`, `endGmTurn()`, `highlighted()`, `reachable()`, `sample(x, y)` (which re-renders inside
the same task, because the drawing buffer is not preserved between frames), `setMode`,
`exportProject`. A spec waits on `(window.__polyheart?.frames ?? 0) > 5` before touching anything.

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
describe it. Not a layer at a time. Look at `6ec74ef` — eighteen files, one sentence of Daggerheart.
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

Everything is vendored under `tools/srd-sources/`; nothing is fetched at runtime or at build time.

| Source | What it is | Use it for |
|---|---|---|
| `official-2.0/srd-2.0.txt` | The **official SRD 2.0** (ver 2026-08-25), extracted from the daggerheart.com PDF by `extract-pdf-text.mjs`. `===== PAGE n =====` markers preserved; sentences grep-able in one piece. | **Rules text. The only thing to quote.** Cite the section in the code comment. |
| `daggersearch/core/*.json` | Community SRD **1.0**, well typed, with JSON Schemas in `_schemas/`: ancestries, armors, classes, communities, consumables, domain-cards, items, rules, subclasses, transformations, weapons. Names and descriptions are localized objects (`{"en-US": …}`). No adversaries, no environments. | Structured content only. |
| `seansbox/*.json` | Community SRD **1.0**, stringly typed (`"atk": "+3"`, `"thresholds": "8/15"`): 129 adversaries, environments, 24 beastforms, abilities, plus its own character data. | The adversaries and environments the other set lacks. |

**Which is authoritative.** For a *rule*, `official-2.0/srd-2.0.txt` and nothing else. The engine
implements SRD 2.0; a section-by-section diff against 1.0 is recorded in `docs/CONTEXT.md`. The two
community sets are still 1.0 and neither upstream had updated as of 2026-09-05. They are fine as
*content* — stat blocks, weapon and armor tables are unaffected by the 2.0 changes — and never as a
rule.

**Known defects in the community data.** `daggersearch/core/rules.json` is a terse summary with two
errors that would propagate: its Failure-with-Fear bullet swaps Hope and Fear, and its
critical-damage line ("double the total result of your damage dice") contradicts the verbatim text
of both 1.0 and 2.0 ("add the maximum possible result of the damage dice"). The engine's default is
the official one; the other is selectable as `criticalRule: 'doubleDice'` for a table that plays it
that way, and `rules/damage.ts` says so in a comment above the flag. `seansbox/adversaries.json` is
stringly typed throughout, which is why `content/srd/seansbox-adversaries.ts` exists; two stat blocks
print `"Horde (/HP)"` with the number missing.

**Both attributions must survive.** The SRD 2.0 DPCGL attribution and the SRD 1.0 one that the
community sets carry are separate obligations and both are kept — the exact 2.0 wording is in
`docs/CONTEXT.md`, and the per-source terms are in the three READMEs
(`tools/srd-sources/{official-2.0,daggersearch,seansbox}/README.md`; there is no top-level one).
Daggerheart is a trademark of Critical Role, LLC; this project is unaffiliated.

**The boundary.** Only vendored SRD *text* enters the repository. The source PDF is deliberately not
committed; only the extracted text is, along with the script that extracted it.

**Adding a field to the normalised adversaries.** `content/srd/seansbox-adversaries.ts` normalises
all 129, and `tests/unit/srd-content-strings.test.ts` asserts they all import with zero issues. Add
a case there before trusting a new field.

---

## 11. Gotchas

- **The repository path contains a space:** `D:\New folder\daggerheart game`, Git Bash form
  `"D:/New folder/daggerheart game"`. Quote it everywhere. The repo has moved between machines
  before: prefer repo-relative paths in code, scripts and docs, and never hardcode a home directory.
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
- **Path aliases:** `@engine/*`, `@editor/*`, `@game/*` resolve; **`@content/*` points at
  `content/*` and there is no `content/` directory at the repo root.** It is a dead alias — `docs/CONTEXT.md`
  lists all four without qualification, and this one does not resolve. Content lives in
  `src/engine/content/` and in the project document.
- **`fflate` is a dependency and is imported nowhere under `src/`.** `CONTEXT.md`'s "zip import and
  export of projects with assets" is not implemented; export is `JSON.stringify` into a `Blob`.
- **No frustum culling and no LOD.** Instancing and geometry sharing exist (`terrain-mesh.ts`,
  `procedural/build.ts` with its `PrimitiveCache` and `MaterialLibrary`); the rest of the efficiency
  goals in `CONTEXT.md` are stated, not met. `docs/CRPG-GAPS.md` is the honest list.
- **No TTS, no speech synthesis, no "voice" features.** A hard constraint from the user; both
  attempts were removed.
- **All content text is English.**
- **`docs/ADVERSARIES.md` and `docs/CARDS.md` are generated.** Editing them by hand is work that the
  next `python tools/*-doc.py` throws away.
