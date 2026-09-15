# Is this an engine for making Baldur's Gate-style games?

An honest audit against the goal in `CONTEXT.md`: *a full CRPG engine + editor for making
party-based tactical RPGs in the style of Baldur's Gate 3, running a dual-dice tabletop ruleset*.

Written 2026-09-05. Updated 2026-09-06 after the editor and the use-verb slices. Re-check it
when the answer changes.

## The short answer

**Most of the way, for one room.** A designer can author a party, a map, and what the things on
that map do, and play it — no engine code. Select between characters, walk with followers
keeping up, cross a trigger into a fight, pass the spotlight, open a locked chest on a Finesse
roll and read what the author wrote about it.

Nothing on the list is a wall any more. What remains is depth — inventory, quests, progression,
presentation — and tools for the authoring that currently happens in TypeScript literals.

The risk this document exists to name: a tabletop-rules library with a renderer looks like
progress and is not the goal. BG3 is roughly a third combat. Everything below is the other
two thirds.

## What is done

| Layer | State |
|---|---|
| Rules (SRD 2.0) | Duality rolls, GM die, damage/thresholds/armor, resources, range, cover |
| Space | Tiles underneath as a navmesh (terrain, A*/Dijkstra, line of sight, occupancy); the rules read distance as the crow flies and move by range band, never by counting squares |
| Content | Content packs imported from a file (Project ▾ → Import pack…) and merged into the project by id, and written back out as one (Export pack); legacy map/campaign importer |
| Scene | Authored document (zod), runtime state overlay, JSON save/restore |
| Combat | One attack, end to end, seeded and replayable |
| Render | Continuous ground per terrain type (vertex-coloured, a wall only where the ground drops), procedural model library, click-to-move demo |
| Characters | SRD classes/ancestries/communities/armor/weapons; sheets deriving the real numbers |
| Scripting | One schema for conditions and effects; a stepper that pauses for input |
| Interaction | Use a thing: keys, locked text, an action roll, effects and prose per outcome |
| Editor | Terrain/height/props/objects/enemies/triggers/spawns, undo, validation, JSON save+load |
| UI | Narrative log with tone, the conversation panel, and the roll prompt a script raises |
| Campaign | Two scenes, travel between them, and state that outlives a room |
| Saving | A campaign put down and picked up: rooms, pack, flags, and the dice position |
| Quests | Start, tick, finish; a journal; a demo quest across two rooms |
| Presentation | Orbit/pan/zoom camera, hover cursor, party HUD with pips, dice read out |
| Progression | Tiered level-ups with recorded advancements, subclasses, domain cards, multiclass |
| Equipping | Weapons and armor from the pack onto a character, reversible, pools reconciled |
| Assets | glTF models declared per project, loaded on first use, drawn beside the procedural library |
| Items | Items and weighted loot tables; a shared pack that survives a doorway |
| Editor | Map tools, scene list, object inspector, dialogue graph, quest form, undo, validation, JSON |

## What is missing, in the order it should be built

Each item says what it unlocks, because order matters more than the list.

### ~~1. The scripting substrate~~ — done, and now actually reachable

`script/conditions.ts`, `script/effects.ts`, `script/runner.ts`, `script/world.ts`. Conditions
over flags, keys, scenario variables and world state; the legacy effect vocabulary typed and
extended; and a **stepper** that pauses on an effect needing input rather than forcing async
into the rules core. Everything it does comes back in a journal.

`script/schema.ts` is the authored form of all of it, and it is the *only* form. There used to
be two effect vocabularies — a nine-variant one a document could hold, and the full union the
runner could execute — with nothing converting between them. An interactable's authored check
was imported, validated, saved, and never run. They are one schema now, so the runner can
execute anything a document can hold.

That claim used to come with a caveat — `goto`, `loot` and `startDialogue`
journalled and stopped there. It no longer does. every effect the runner has now does
something, which was not true a slice ago.

`scene/interact.ts` is the verb that was missing: reach a thing, and its authored `requiresKey`,
`lockedText`, `check` and outcomes actually happen. The legacy vault's own furniture — a Finesse
13 door, a trapped chest, a Strength 12 pillar, every line of prose written by the original
author — plays through it.

Two known simplifications, both in `game/demo-scene.ts` rather than the engine: a check rolls
with the *best* trait in the party rather than the acting character's, because
`SceneScriptWorld` takes one traits map at construction; and using something in a fight spends
that character's action, which is a choice rather than a rule read out of the SRD.

### ~~2. Dialogue graphs~~ — done, and shipped in the project file

`dialogue/dialogue.ts` runs a conversation: speakers, lines, replies gated by conditions,
replies that cost a roll and route by its outcome, effects on choosing. `dialogue/schema.ts` is
the authored form, and `ProjectDoc.dialogues` carries it — so Save JSON writes the words as well
as the map, which is what makes conversation authorable at all.

`startDialogue` **pauses** the script that ran it, the way `check` and `choice` do; the caller
plays the conversation out and resumes with `continue`. Journalling it and running on would have
left the order of everything after it undefined.

That nesting is the interesting part, and `game/demo-scene.ts` holds it: a script stops on a
conversation, the conversation itself stops for a Presence roll, and only when it ends does the
script that opened it carry on. Both runners keep cumulative journals, so both need the same
"what has already been shown" guard.

`danglingLinks` and `unreachableNodes` run in `validateProject`, along with a walk over every
node's effects — a reply that starts a conversation nobody wrote is an error before it is a
crash.

**Still open:** nothing. A dialogue is written in the editor's Dialogue panel — nodes, replies,
conditions and the effects a reply runs — and validated with everything else.

### ~~3. The turn loop~~ — done

`combat/encounter.ts`. No initiative, as the SRD has none: the party acts until a roll hands the
spotlight over, the GM spotlights one adversary free and spends a Shadow for each additional one,
then it passes back. The SRD's optional Spotlight Tracker is a second policy rather than a
different code path. Victory and defeat settle themselves.

### ~~4. Party control~~ — done

`scene/party.ts`. Selection with wrap-around cycling, per-member movement, allies transparent
out of combat and solid in it, and the follow-the-leader trail the prototype had.
`scene/triggers.ts` indexes the map's trigger cells so walking into one starts its encounter and
stops the mover there rather than letting them run past the ambush.

### ~~5. Characters — classes, ancestries, equipment~~ — mostly done

**Packs are imported, not shipped** (2026-09-13). The engine ships a small original starter pack;
anything else arrives through **Project ▾ → Import pack…** (`content/pack/document.ts`), which lays a
pack file's classes, cards, adversaries, abilities and conditions into the project as one undo step.
The rest of this section describes the catalogue as it was while it was vendored. It is now an export
that whoever holds the rights imports, and the counts below are that export's.

**Everything a character has is a card** (format version 3). What a class, subclass, ancestry or
community prints is a card granted by it, and an ability sits on its card by id, so the
name-matching that paired a printed feature with its ability is gone, and the GM's side names
nothing directly any more: a stat block's feature is an ability on a card printed on the block. What a condition lends is a card too (format version 4), in its bearer's hands while it lasts. The Cards panel edits every card an
ability sits on, a pack's through a copy the project plays instead.

`content/pack/import.ts` imports the 9 classes, 18 ancestries, 9 communities, 34 armors and
192 weapons; `character/sheet.ts` turns a sheet naming those by id into the numbers the rules
already consume — Evasion and Hit Points from the class, damage thresholds and Armor Slots from
the armor plus level, and an attack profile whose trait, range and dice come from the weapon.
The demo party is three authored sheets rather than three literals.

**Progression is in** (`character/progression.ts`). Subclasses and the 189 domain cards are
imported from the vendored SRD. A sheet *records* its levels — each one's two advancements, the
domain card it granted, the Experience at a tier threshold — and `deriveCharacter` folds them into
the numbers, so a grown character is data a save can carry and an editor can show. The rules as
implemented: two picks per level from the tier's option table (traits ×3, Hit Point ×2, Stress ×2,
Experiences, an extra domain card, Evasion; from tier 3 also a subclass upgrade, Proficiency and
Multiclass, the last two costing both picks), or from what the previous tier's sheet left
unmarked; one new domain card per level from the character's domains at or below their level; at
levels 2, 5 and 8 a new Experience and +1 Proficiency; trait marks cleared at 5 and 8; multiclass
opens one domain of the second class. A plan is legal or nothing happens.

There are no experience points — the GM says when — so levelling is a `levelUp` **effect** a
designer places as a milestone; the demo grants one when the strongbox opens. The HUD offers a
"Level up" on each card with a level waiting; the sheet shows every option with its boxes left
and its cost, the card's text, and the engine's reasons when it refuses. Pools grow without
clearing a wound, the script world picks up a raised trait, and the grown sheet rides in the save.

**Verified against the core rulebook** (Chapter 2, "Choosing Advancements"): the tier table was
originally transcribed from memory and had a subclass box on tier 2 that the printed sheet does
not have. It now matches the sheet, including the "or any from the previous tier" boxes, the
extra-card caps (level 4 on the tier 2 sheet, 7 on tier 3) and the cross-outs between the
subclass-upgrade and multiclass boxes.

**Cards do things now** (`content/abilities.ts`, `content/pack/starter-abilities.ts`, `game/demo-abilities.ts`).
An ability — a domain card, a class's Light feature, a subclass card — is a script in the one
effect vocabulary with a cost, a target, uses and a reason it is greyed out. The vocabulary
learned what a card needs: a `check` can roll the Spellcast or weapon trait against each
target's own Difficulty and bind the ones it beat to a `hit` selector; `damage` rolls dice
through thresholds, armor and reactions once for every target; Stress, Light, conditions with a
duration, a weapon attack, a knockback and reaction rolls are effects. Passives fold into the
sheet (`modifiers`), conditions are content with modifiers of their own, and a defence step
(`combat/defense.ts`) decides Armor Slots and damage reactions automatically. The loadout holds
five cards with the rest in a vault (Recall Cost in Stress outside a rest); rests take the SRD's
downtime moves; Utilize an Experience spends a Light on a roll; the action bar, a targeting
mode, a loadout panel and a rest panel put all of it on screen. The GM's adversaries approach
before attacking; a condition that `blocks` acting (Stunned, Asleep) or moving (Restrained)
costs them the spotlight, and the GM spends a Shadow to wake a sleeper when there is one. A
grimoire's spells read their words from the card's named features.

Logic the vocabulary cannot say is **code**: `{ kind: 'run', hook }` and `{ kind: 'hook' }` reach a
`project.code[]` entry, written in the editor's Code panel or brought in by a pack -- Import pack
and Load ask first about any the project does not already run, since code is not sandboxed. The
engine ships none. A hook reads the world and *queues effects*, so nothing escapes the
journal, and rolls only off the seeded stream (`Math.random` throws). The demo ships one card
written that way.

A hit on a party member is put to them: an Armor Slot, a reaction they can pay for, or an ally's
interrupt — I Am Your Shield redirects it, Not This Time makes the adversary reroll. The GM's
turn is resumable, so it waits on the answer and carries on afterwards.

Cards that carry tokens hold them (`tokens` on an ability, `addToken` / `spendToken` /  a
`tokens` condition), refilled at the rest the card names. A miss can be answered too, which is
what applies Hidden — Vanishing Dodge. Adversaries play their own stat blocks: Relentless, Horde,
Minion, Momentum and Terrifying are read off the block, and action or reaction features are
abilities in the same vocabulary, on cards printed on the blocks that carry them.

**Still open:** the engine ships only its starter pack, so how much of a catalogue is scripted is
the pack's to say rather than a number kept here; what a pack leaves unscripted is text the table
reads. Resistance, immunity and the number a block takes off the
damage are now a `defenses` line on a passive or a condition, read wherever damage lands; the
swing a block prints is a `standardAttack` line, and a rider that follows it is a reaction to
`dealtHit` or `dealtDamage`. What is left of that group is the passives on a number the engine
does not have — a damage swap on a condition, a rider on *being* attacked — and the features
aimed at an ally, which the GM's turn has no way to point at one. Damage
from a feature or a card resolves without asking the defender: the prompt covers an adversary's
standard attack. A party swing's own Light and a critical's cleared Stress arrive when the roll is
made, before the cards that answer its damage roll, which is the SRD's order.

### ~~6. Inventory, loot and equipping~~ — done

`content/items.ts` holds items and loot tables; `ProjectDoc` carries both. The party's keys
became items — a key is an item you have one of, `hasKey` is `hasItem` with a quantity of one —
so there is one idea for anything carried rather than two vocabularies.

`loot` resolves **in the runner**, not in a UI layer, so a chest, a dialogue reply and a check
outcome all pay out the same way. Tables are weighted and drawn from the scene's own `Rng`, so
what a chest holds is as replayable as the roll that opened it, and a table-less `loot` (which is
all the legacy importer produces) finds nothing rather than throwing.

The demo's vault chest and the pit's strongbox draw from different tables, and `PlayPanel` shows
what the party carries. Validation catches a `loot` naming a table nobody wrote, a table that can
drop something which is not an item, and an `addItem` for an item that does not exist.

**Equipping is in** (`equipItem` in `game/equip.ts`). A carried weapon or armor item whose
`contentId` names SRD gear can be put on whoever is selected, from the pack. The piece comes out
of the pack and what it replaced goes back in when the project has an item for it (the demo ships
items for the party's starting gear so a swap is reversible); the sheet is re-derived, the attack
profile changes, Armor Slots follow the armor without clearing a mark, and the HUD card names
what each character wields and wears. Armor cannot be changed mid-fight; a weapon can — that is
this engine's rule, not the SRD's, chosen so a fight cannot be paused to change into plate.

Consumables work: an item carries `use` effects in the one vocabulary (a draught heals the
`actor`; a scroll could start a conversation), the pack offers **Use** on whoever is selected,
a consumable is spent before its effects run so a `loot` inside them cannot hand it back, and
in a fight using something is the character's action. Validation walks an item's effects like
any other script.

### ~~12. Saving a game~~ — done

The 2026-09-10 pass also fixes the `@content/*` alias in TypeScript and Vite to point to
`src/engine/content/*`. The loadout browser shows every domain card with search and domain
filters, full rules inspection, and keyboard-accessible active/vault swaps. The rules text is
the vendored SRD's and the art is generated per card from its id (`ui/card-sigil.ts`), so the
browser needs no asset directory and carries no artwork licensing question.

A save is *state over a project*, not a copy of one: it names the project it belongs to and
carries only what play changed — the room being played, where everyone stands and what they have
taken, the pack, the flags and variables, every room already visited as it was left, the log, and
where the dice had got to. `game/save.ts` assembles it; `ScenarioState` learned
`scenarioSnapshot`/`restoreScenario` the way `SceneState` already had `snapshot`/`restore`.

Restoring in place matters more than it looks: every `SceneScriptWorld` holds a reference to the
scenario, so handing back a fresh object would leave the live room writing flags nobody reads.
So does the RNG position — a save that only kept the seed would re-roll numbers the session had
already spent, and the reload would diverge from the game it came from.

Three moments **refuse** to save: a fight, a pending ambush while the party approaches, and a script waiting on an answer. Fights and scripts
hold live objects with no serialisable form — `EncounterRunner` owns action tokens, whose turn it
is, and a reference to the scene it started in; a pending prompt is a paused `ScriptRunner`
mid-conversation. An approaching ambush is not serialized, so saving there is blocked to prevent losing the encounter on reload. A save is a checkpoint between beats, and the Save button says why it is greyed.

Loading restores the party to the tiles they were standing on rather than to the spawns, which is
what separates it from `travelTo`. A save for another project is refused, and damaged text is
reported rather than thrown.

Saves are **named slots** (`game/save-slots.ts`, DOM-free over an injected store): a quick slot
and an autosave slot that are overwritten, and "Save as…" minting a new one each time, listed
newest first with where the party was. The autosave is written whenever the party changes rooms,
detected in `refreshPlay` rather than hooked into `travelTo`, because a script's `goto` travels
without passing through `main.ts` at all.

**Still open:** nothing. A save carries the last `SAVED_LOG_LINES` of scrollback (`game/save.ts`)
rather than every line the campaign ever wrote — the tail is what a player picking the game up
wants, and it is the save that gets written to disk and rewritten every time the party changes
rooms. The live log is deliberately not trimmed to match: four callers read it by index, a use
reporting what it added as `log.slice(before)`, and trimming under them would hand back somebody
else's lines.

### ~~7. Quests and journal~~ — done

`content/quests.ts` holds a quest: a name, a summary, and a flat list of objectives. Progress is
not content — it lives in `ScenarioState.quests` beside the flags and the pack, so it travels
between rooms and into a save (the save format defaults the field, so a save written before
quests existed still loads).

The vocabulary grew four effects (`startQuest`, `completeObjective`, `completeQuest`, `failQuest`)
and two conditions (`quest` with a status, `objectiveDone`), in the one schema. The rules are few
and each is a decision: starting is idempotent and journals once; ticking a step starts the
quest, so "the party found the thing" is one effect; completed and failed are terminal; and
finishing is **explicit** — ticking the last objective does not complete a quest, because "you
have everything, now bring it back" is a beat a designer places on purpose.

Quest events are news in the narrative log ("New quest: …", "Objective complete: …", "Quest
complete: …"), unlike the flags underneath them. The play panel shows a journal: active quests
with ticked and unticked steps, finished ones sunk to the tail. Validation catches an effect or
a condition naming a quest or an objective nobody wrote — which meant teaching the validator to
walk *conditions* for the first time — and warns about a quest nothing starts or a step nothing
ticks.

The demo's quest threads through content that already existed: the pillar starts it, winning
the word ticks the first step, and the strongbox downstairs ticks the second and closes it.

Objectives can be **hidden** until revealed — by a `revealObjective` effect, or by being
completed — so a quest unfolds rather than listing its plot on the first page. The demo's
strongbox step stays out of the journal until the Warden has been talked round, and "New
objective:" lands in the log when it appears. The quest form has a *hidden* box per step.

A step can carry the **summary the journal shows once it is done** (`QuestObjective.summary`;
`journalSummary` picks the latest done step with one, in the quest's own order, and the opening
summary until any is) — a BG3 journal rewriting itself as the story turns, without a second
notion of "stage" beside the steps a designer already writes. The quest form has a "Then the
journal says…" box under each step; the demo's quest stops describing the pillar and starts
describing the pit once the word is won.

**Still open:** nothing.

The editor has a quest list and a form — name, summary, steps — because a quest is a list and a
list is edited as a list; the graph was the right call for conversations, not for this. The
effect editor offers the four quest effects with the quest picked from a dropdown and the
objective dropdown following the chosen quest, so an effect can never name a step of a different
quest. What is written in the form is what the journal shows, checked end to end.

### ~~11. Scene travel~~ — done

`travelTo` in `game/room.ts` swaps the per-scene half of the world — scene, grid, state,
pathfinder, party, triggers, script world — and keeps the campaign half. Wounds, Stress, Light and
the GM's Shadow travel with the party; where everyone stood does not, so they arrive on the new
scene's spawns. A room already visited is restored from its snapshot, minus its stale party
entities. `SceneDoc.intro` is finally read by something.

Story flags and the keys the party carries moved from `SceneState` to `ScenarioState` first, and
that had to happen before travel rather than after: a scene snapshot serialised them, so
returning to a room would have restored that room's stale flags over the campaign's real ones.

A `goto` is **remembered, not taken**: travelling mid-script would carry the rest of that script
into the wrong room, so the destination is spent once nothing is waiting on the player. Walking
out abandons a fight rather than dragging it along — the snapshot keeps the adversaries where
they stood, and a party fleeing through a door is what actually happens.

The demo ships two rooms: the imported vault, and a hand-authored pit whose strongbox only opens
for the word the Warden gives up. That is the two halves meeting — a conversation in one room
decides whether a chest opens in another.

Arriving **rebinds** the one `SceneView` (`SceneView.rebind`) rather than building another: the
terrain is rebuilt for the new grid, the decos replaced, the sun refitted to the room's extent,
the overlays cleared (and grown once, if the room is the biggest yet), while the lights, the
geometry and material caches, the asset listener and the party's own tokens carry over - a token
forgets where it was drawn, so it is put down on its spawn rather than glided in from the other
room's coordinates. Fifty rooms cost fifty terrain rebuilds and nothing else.

**Still open:** nothing.

### ~~8. The editor~~ — first pass done

`editor/session.ts` holds a project and every reversible change to it (command-based undo, brush
drags coalesced into one step); `editor/controller.ts` decides what a click means given the tool
in hand; `editor/validate.ts` reports the mistakes a schema cannot catch — a spawn in a wall, a
trigger sealed behind one, an adversary with no stat block, an encounter nothing can start;
`editor/ui/EditorShell.tsx` is the shell over all of it, and `editor/modes.ts` decides which tools
each of its modes offers. Ctrl+E toggles play and edit.

**The shell (2026-09-10).** The user judged that editor "not even good enough to be called a
prototype", and it is being rebuilt to their direction. The plan is
`docs/superpowers/specs/2026-09-10-editor-shell-design.md`. The first slice replaced the side panel
with a Blender-grey top bar of four modes (Inspector, Terrain, Combat, Interaction):
- each mode has a tool rail, a library strip and a side panel;
- content editors open as workspaces under the bar;
- Combat's eraser takes creatures, trigger cells and party starts.

**Sparse construction (2026-09-11).** Terrain now offers stackable block, floor, wall and stair
pieces, three materials, quarter turns, a level plane with placement preview, square brushes,
level-specific erasing, grouped undo and JSON round trips. Coordinates extend to ±1,000,000
on all three axes without allocating intervening cells. The renderer indexes 16³ chunks,
uses instanced beveled/simple/silhouette LOD, frustum and distance culling, a 96-chunk residency
limit and two chunk builds per frame. Unchanged chunk buffers survive edits; unloaded buffers
are disposed. Tests check actual triangle counts and residency, not an FPS promise.
`window.__engine.buildingStats()` exposes current tile/chunk/instance/triangle/LOD counts.
The legacy ground mesh and props do not gain LOD from this change. Construction is scenery:
multilevel walking, collision and LOS remain open, as do selection/moving of whole assemblies.

**Placement follow-up.** Multiple independent pieces can share X/Y/Z, including four edge walls
around a floor; erasing peels away the latest instance. Vertical Z supports quarter tiles and
pieces have adjustable vertical size. The ground's `heights[]` is still whole levels: two
vertical units coexist until part 2 picks one.
Terrain library tabs directly choose placement, without separate place/paint rail buttons; the
open tab and the tool in hand are one fact (`editor/modes.ts`), so every tool has a tab and the
rail always shows the tool being used.
Editor creatures now render from the scene document, including remote or elevated placements.
A creature whose definition has no model of its own draws as a husk body, in edit and in play,
so a board of 129 SRD stat blocks can be read; `ModelRegistry.missing()` still lists the id and
`SceneView.modelSource()` still answers `fallback:husk`, and part 4 gives them art.
Undo and scene switches reconcile the visible placements. Every entry into a room — travelling
in, loading a save, coming back from the editor — brings in the creatures the document has
gained and takes out the ones it has lost, without resetting existing creatures and without
resurrecting one a script removed. A placement authored outside the board is scenery the editor
draws and warns about: it never enters play. Elevated/outlying navigation is still open.

Tools: construction/erase construction, terrain brush, raise/lower, props, objects, adversaries, trigger cells, spawns, erase,
inspect. Save and load a project as JSON. The brush paints terrain only — a wall painted on flat
ground stops movement and reads as dark floor until Raise gives it height, which is deliberate:
elevation is its own tool because low walls and tall walls play differently.

A **scene list** sits in the panel: switch, add, rename, delete, and choose which scene the
project opens on. Editing a scene is decoupled from playing one — browsing rooms in the editor
does not move the party, abandon their fight, or throw away a prompt they were holding, and the
view binds to whichever room is on screen rather than to the party's.

That decoupling turned up a split the terrain brush had been hiding: the editor and the game held
two different `ProjectDoc` objects, because `projectSchema.parse` copies. Terrain edits reached
play only because the grid is written in place; a scene added, renamed or deleted in the editor
was invisible to the game. They are one document now.

An **inspector** edits the object under the Inspect tool: its name, flavour, kind, whether it
blocks movement, the key it wants and what it says without one, the effects it runs with no roll,
and the roll itself — trait, difficulty, and effects per outcome down all five branches.
`EffectList` covers the flat vocabulary and picks scene, dialogue and encounter ids from what the
project holds rather than having them typed, so the commonest authoring error cannot be made.
Every effect kind is editable in place. `branch` has a **condition editor**
(`ui/ConditionEditor.tsx`) for its `when` — nesting for `not`/`all`/`any`, quests, objectives and
encounters from dropdowns — and two nested lists; the same editor gates a reply in the graph
(*if…* hides it, *only if…* greys it) and an option in a `choice`. A `check` anywhere — on an
object, inside a list, on a reply — uses one **check editor** (`ui/CheckEditor.tsx`): trait,
difficulty, prompt, an effect list per outcome, and for a reply the nodes a success and a
failure lead to. `story`, `setVar`, `addVar`, `addItem`, `removeItem` and `endEncounter` are
inline fields.

A **dialogue graph** (`ui/DialogueGraph.tsx`) draws a conversation as a tree: node cards on a
pannable surface, links curving from each reply to the node it leads to, a check's success and
failure branches in green and red, and a dangling link drawn as a red stub with the id it cannot
find — the validator's error made visible where it was made. Drag a node, type its lines, add and
rewire replies, give a reply a roll, set which node the conversation opens on.

`layoutDialogue` (in `engine/dialogue/`, DOM-free) places nodes by breadth-first distance from
the start, so a conversation written by hand opens as a readable tree. It never writes the
document: a position is stored only when someone drags a node, so opening a file and moving one
thing is a one-node diff.

A **party panel** writes the characters themselves. The party moved out of `demo-scene.ts` and
into `ProjectDoc.party`, so a campaign carries who it is about; the panel picks every id from
the vendored SRD content, narrows subclasses to the class and cards to the character's domains
and level, and shows what a sheet comes to — Evasion, Armor Score, pools, thresholds — as it is
written. `deriveCharacter`'s own issues are the validation, so the editor reports exactly what
the game would refuse. Levels are shown, not edited: a level is taken at the table.

An **items panel** writes the pack: items with their kind, their stacking and an effect list for
what using them does, and the loot tables that hand them out — draws, entries, quantities as a
fixed count or a rolled range, and weights shown as the odds they work out to. Deleting an item
leaves the references that named it alone, so the validator can report them.

**Play from here** (`playAt`): the editor's "▶ Play here" enters the room being edited through
`travelTo` and the party arrives on its spawns; Shift-clicking a tile in the editor gathers them
round that tile instead (`gatherParty`: the selected one on it, the rest on the nearest free
floor), so a room is tested from the spot in question rather than walked to from the vault door.

A character added in the panel joins when Play is pressed (`syncRoster` in `game/demo-scene.ts`):
derived from the sheet, given a fresh sheet's pools, stood beside the party on the nearest free
tile, announced in the log - and in a fight if there is one, since the spotlight tracker reads
the party off the board each time it asks who is ready. One removed leaves the same way, after
the fight if there is one.

**Still open:**
- Creature placements now draw from the document; other editor overlays still need authoring views.
- Trigger cells and spawns are never drawn.
- No object has a model, so doors, chests, pillars and stairs are invisible in play too.
- Only objects can be inspected.
- Combat still holds the original tools; construction needs multilevel navigation.
- **Editor camera**: right-drag pan, middle-drag orbit, wheel zoom, WASD/arrows, Q/E and Home work in edit mode;
  **F (frame the selected character) is still play-only**, there being no selection to frame.
- No creature *ships* with a model of its own: 128 of the 129 SRD stat blocks draw as a husk body
  until one is assigned, and `window.__engine.missingModels()` lists them. Since 2026-09-11 that
  is a default rather than a ceiling: taking Select in Combat and clicking a creature opens a panel
  that points a whole adversary type (`project.adversaryModels`) or that one placement
  (`model` on the placement) at any built-in or imported model.

### ~~9. Asset import (glTF)~~ — done

A project declares models (`ProjectDoc.assets`: an id, a URL, a scale, a ground offset, a turn)
and content names them exactly as it names a procedural model — a prop's `model`, an object's
`model`, an entity's definition. `engine/render/assets.ts` is the library: DOM-free, with the
loader injected, so a test drives it with a fake and the browser hands it three's `GLTFLoader`.
`SceneView` asks the library first and the procedural registry second; a declared model that has
not arrived yet is drawn as the placeholder *without* being counted as missing, and when the
file lands only the tokens and props drawn from that id are rebuilt. Skinned models clone through
`SkeletonUtils`, so the Khronos Fox walks in with its rig. A faction ring still goes under an
imported token, so a side reads at a glance.

The editor's Models panel picks a `.glb`/`.gltf` from disk and reads it **into the project**, so a
saved document carries its art and opens anywhere; the row reports the file by weight rather than
printing the encoded bytes, and **Check** warns past 8 MB. Scale, ground offset, facing and the four
clip states are set in the same panel, the clip lists being the names the file itself carries, read
back once it has loaded. A model referenced by a path still works and shows that path. Two e2e cover
it: one imports the Khronos Duck by URL, draws it where a prop names it and finds it in the exported
JSON; the other picks the Khronos Fox through the file input and chooses its own `Survey` clip as
the idle.

An imported model with clips plays its first one on a loop (an idle, in every sample set
worth the name); `SceneView.tick` drives the mixers from the frame loop.

The procedural tokens walk, flinch, fall and rise (above); an imported glTF plays its first clip
on a loop and gets the same glides and falls as a whole.

An asset names **which clip plays for which state** (`ModelAsset.clips`: idle, walk, hit,
fallen, by the clip's own name); the view plays the walk while a token glides, the hit once as
it flinches, the fall to its last frame as it goes down, and the idle otherwise. A state with
no clip named keeps what is playing, and a file with nothing named loops its first clip as
before.

**Still open:** textures come with the file but nothing authors materials — no tinting, no texture
swap, no override of what the file ships with. (The file picker that used to be listed here landed
on 2026-09-12.)

### ~~10. Presentation the prototype had and this does not~~ — mostly closed

The **narrative log** exists (`game/ui/PlayPanel.tsx`): tone-coloured lines, and the prompt a
script raises when it stops for a roll, with the option to step back from it. Text only —
CONTEXT.md rules out narration, and a conversation UI is exactly where that creeps back in.

The **camera** moves (`engine/render/camera.ts`): an orbit camera kept as plain numbers — target,
yaw, pitch, distance — with clamps, screen-relative pan and easing, tested in node. `main.ts`
owns only the events: left drag orbits in play and middle drag in either mode, right drag pans,
the wheel zooms (Ctrl + wheel moves the build level in the editor), WASD/arrows slide,
Q/E turn, F frames the selected character, Home frames the room. A press that moves under six
pixels is a click, the line the prototype drew with `OrbitControls`; here it is ours and tested
end to end. The camera **follows a walk**: while the selected character's token is on its way,
the target is pulled just far enough to keep them within a third of the view's distance of it
(`OrbitCamera.follow`) - angle and zoom untouched, nothing moved for a short walk, and never
while the player is dragging or holding a key.

A **HUD** (`game/ui/PartyHud.tsx`) shows each party member as pips — every Hit Point, Stress and
Armor Slot a box, filled when marked, the way the character sheet looks — plus Light, conditions,
the GM's Shadow and the round. Clicking a card selects. The tile under the pointer is **marked**,
so a click has a visible target.

**Zones are on the floor.** A standing zone paints the tiles it holds (`SceneView.showZones`, one
instanced layer under the highlights, a colour per zone), and the tiles come from
`world.zoneFootprint` - the same measure `refreshZones` uses to decide who is standing in it, so
the picture is the rule. A zone's condition names its colour (`ConditionDef.color`); one that
names none gets a hue spun from its id, so nothing scripted later is invisible. Each zone is
outlined along its edge - a side with no tile of the same zone beyond it - so a Melee cross reads
as a shape rather than five loose tiles, and two zones touching keep their own edges. The overlays
(zone ground, zone edge, walk highlight, pointer, selection ring) draw in that fixed `renderOrder`
rather than by whichever is nearer the camera.

**The room has a sun.** The light rig is a sky (`HemisphereLight`), a little ambient, and a
directional sun that casts, about fifty degrees up, with a shadow camera fitted to the map's
extent so a room of any size is inside it. Walls and raised slabs cast onto the floor beside
them, props and tokens onto the tiles they stand on - the depth cue that makes a wall read as
standing rather than painted. **Whoever is selected is ringed** on the board in the same blue
their HUD card is edged in, breathing slightly so the eye finds it; the ring is a mesh of its
own rather than a recoloured base ring, because tokens share materials. Every SRD class maps to
a hero body (`DEMO_MODELS`), so a character added in the panel stands as a person and not as
the magenta placeholder - which stays what it is, the library's honest "no model for this id".

**Numbers over heads.** A wound, a miss, Stress marked or cleared, Armor cleared, Light gained, a
healing, a condition going on - each rises over the creature it happened to, in the log line's
tone colour (`DemoScene.floaters`, written beside the log line from the same journal entry;
`main.ts` draws them as positioned divs projected from the tile, so they use the page's font and
no texture). What happened to the room or the party as a whole stays in the log. A headless run
never draws them and loses nothing.

**Tokens walk.** A token whose creature is found on another tile glides there - along the path
walked when the game says which (`DemoScene.motions`: the party's own walk, an adversary's
approach), straight otherwise - a fixed time per tile with a small hop on each; one that was
thrown is flung in a quick arc. The engine's truth never waits: `state` already has the creature
there, `syncTokens` starts the glide and `tick` finishes it, `settle()` ends every glide now, and
`syncTokens(state, { snap: true })` puts a token straight down. A view rebuilt for another room
starts with nothing in flight.

**Tokens take it.** A blow that lands makes its token flinch - a quick swell and a lean, gone in a
third of a second (`Motion.struck`, written beside the wound's floater; `SceneView.flinch`). A
creature found fallen since it was last drawn falls - slow to start, quick to land - and one found
standing again gets up the same way round; a fall wins over a flinch landing at the same moment,
and a load (`snap`) poses the body outright. The old instant -90° rotation is what a token first
seen lying still gets.

**Dice** are read out rather than rolled on screen: "Light 8 + Shadow 7 + 2 = 17 vs 12. Success,
with Light." Only the parts that applied are named. That is the part of dice presentation a
player needs to trust the outcome; a 3D roll is theatre on top of it.

A still **right-click** inspects what is under the pointer — a party member (class, level,
gear, pools, Evasion, conditions), an adversary (tier, role, description, Difficulty, pools) or
an object (kind, flavour, whether it is open, used or gone, what it asks for) — as a card in the
play panel; Escape or ✕ closes it.

**Still open:** nothing. A name in the log points at whoever it named: the line collects the
creatures it mentions where it is written and the board is to hand, the panel cuts the sentence
on those names, and hovering one leaves the same marker under their tile that the pointer does.
Both line factories - `note` and `record` - mark on the way in, so a sentence written tomorrow
gets it for nothing.

### ~~13. Gridless~~ — the rules and the picture; where a creature stands is open

"It wasn't meant to be played on a grid." Two slices closed most of it:

**The rules** (`bandForSpan` in `rules/range.ts`): every distance between two tiles is as the
crow flies, measured to the nearest tile, through one function - the attack, an area, a script's
walk, a zone's footprint. A diagonal neighbour is Melee, `diagonalAdjacency` is gone. A move in
a fight is the SRD's "within Close range": a disc round the mover (`MovementContext.maxSpan`),
not a count of steps; out of a fight nobody counts at all. The demo walks diagonals
(`DEMO_MOVEMENT`), as do scripts' `drawIn`/`breakAway` and an adversary's approach.

**The picture** (`render/terrain-mesh.ts`, `render/scene-view.ts`): the ground is one continuous
mesh per terrain type - a top per tile, a wall only where the ground drops, corner colours the
mean of the tiles sharing them at that height, so a tint reads as a patch of ground and a step
keeps its edge. Fills are seamless and bordered (`outline`), reach is lit only in a fight as the
Close-range disc, and the pointer marks a spot with a disc.

**Where a creature stands** (`EntityState.at`, `grid/walk.ts`): a spot in tile units, continuous;
`tile` is the tile the spot rounds to, kept in step by `SceneState`, and is what every rule reads -
range, occupancy, line of sight, zones, triggers all measure by tile, the way a gridless VTT snaps
its measurements to 5 ft. A click on the ground is a spot, and the creature walks to it: the
pathfinder's tiles are pulled into a straight line wherever a body (radius 0.35 of a tile) can
stand all the way (`smoothPath`), the walk ends at the spot when a body fits there clear of
everyone else and as near as one does otherwise (`settleEnd`), followers stand a tile further
back each along the line the leader walked, and the token glides along that line at a steady
pace, arriving at the spot. A save keeps the spot; one from before spots restores at centres.
Placements a designer makes, `gatherParty`, `standBeside`, knockbacks and summons still land
on centres, which is what they mean. Driver: `walkTo(x, y)`, `standingAt(id)`, `screenAt(x, y)`.

**Walking like BG3** (`grid/walk.ts`, `scene/party.ts`, `game/demo-scene.ts`): bodies block,
not squares (`blockedFor` holds every tile a body overlaps, `bodyFree` is what a placement asks);
every walk on the board - the party's, a follower's own, a scripted `drawIn`/`breakAway`, an
adversary's approach - crosses a straightened line carried on the motion or the journal's
`moved.route`; a fight's move is Close range spent along the way (path cost, diagonals at root
two) rather than a disc; a click beyond reach walks to the nearest reachable spot out of a fight
and as far as the move allows in one (`nearestReachable`) - unless a run would get there, which
asks for an Agility Roll first (Movement Under Pressure: `underPressure`, `runForIt`); the hover path (`previewWalk`,
`SceneView.showPath`) draws the line a click would walk, the part past one move in red, or amber where a run would cover it; tokens
face where they go at a fixed pace per tile and keep their feet down; and a click on an enemy
out of reach walks to where the weapon reaches from and swings (`closeToStrike`,
`previewStrike`), the move being part of the action. An adversary that cannot swing from within
Close spends its turn walking as far as Very Far instead (`approach`). Driver: `previewAt(x, y)`,
`pathPoints()`, `underPressure()`.

**Still open:** nothing that "gridless" asks for. Measuring range from the spots rather than
the tiles is a choice, not a gap: it would make a corner-to-corner neighbour standing at the
far edges of two tiles read as Very Close, which no table would call it. The one place the
engine's truth waits on a drawing: a walk that wakes an encounter holds it as `demo.ambush`
until the tokens get there (`arrive`, called from the frame loop when the last glide ends, or by
the move itself headless), and nobody walks or swings in between - BG3 holds the round the same
way. Drivers in a hurry call `arrive()`.

## How to tell whether this is on track

A good check at any point: **could someone build a small BG3-like scenario with this and no
engine code?**

A scenario *runs*: `src/game/demo-scene.test.ts` and `tests/e2e/demo.spec.ts`
walk a party into a vault, fire a trigger, trade blows with an SRD adversary and pass the
spotlight, all from content plus a seed. It can now also be **authored**: the party, the map,
the objects on it, the conversations, the quests, the cards and the logic behind them are all
project data with a panel apiece — the party, items and loot included. Nothing a small
scenario needs is typed into JSON by hand any more, beyond a custom condition definition or a
terrain palette.

`editor/authored-scenario.test.ts` is that claim as a test. It reaches for none of the demo's
literals: a blank project, then the same session edits the panels run — a character, an item, a
loot table, a chest that pays out, a door that wants the key, an adversary and the cell that
wakes it — then `buildProjectScene` and *play*. The door refuses, the chest answers it, the
door opens, walking onto the marked cell starts the fight, and the thing past it can be swung
at. Writing it found two hidden literals: a room was stood up for the party the demo ships
rather than the one the document carries, and an adversary the SRD did not know was silently
replaced by the demo's stand-in — a substitution that now happens once, in the document, when
the legacy map is imported, so what a project says is what it plays.

**Load restarts the game on the loaded project**, which is what makes the round trip real: write
a party and a room in the panels, save, load, play. It refuses mid-fight, on a document that
does not parse, and on one that parses but cannot be stood up.

A designer can now author a *party* (sheets naming a class, ancestry, armor and weapon), a
*map* (terrain, elevation, props, objects, enemies, triggers and spawns, saved as JSON and
loaded back), and *what the things in it do* — a check, its difficulty, and effects and prose
per outcome, all as document data the engine executes. None of it needs engine code.

Conversation is authorable too, as of this pass: the demo's pillar holds a five-node
conversation with a reply hidden until the party knows the Warden's name and a reply that costs
a Presence 13, and the whole thing is document data that survives Save JSON.

The Dialogue panel (`editor/ui/DialogueGraph.tsx`) authors the conversation graph, including
replies, conditions and checks; the demo conversation is also available as authored project data.

So the honest answer today is: *a designer can build the party, the place, what everything in it
does, what it says, and the way between rooms — all of it in a tool.* What is left is depth
rather than authoring: quests to track, characters who grow, and a camera that
moves. The line has moved past authoring, past the empty `loot`, and past a game you could only
play in one sitting. What is left is what a campaign needs to be more than a session: quests to
track (7), characters who grow and can change what they carry (5, 6). The camera moves now (10).

A scripted check now moves the pools the way an attack does: a roll with Light hands a Light to
whoever used the thing (`ScenarioState.actorId`, which is the selected character — the check
rolls with the party's *best* trait, the Light goes to the one who touched it), a roll with Shadow
hands the GM a Shadow. And an interactable can be marked **repeatable**: the demo's pillar is, so
the Warden can be talked to again and the reply gated on knowing the name is reachable.

The vault door is picked, not force-opened: the last workaround in `buildDemoScene` is gone. A
door imported from the legacy map is `repeatable`, so a lock that refused once can be tried
again, and an open thing refuses to be opened twice.

Doors did learn one thing they should have known all along, while the save was being written: an
open door stops blocking its tile, on every path into a room. It used to be a line in
`buildDemoScene` that reached past the state and cleared the blocking index by hand, which meant
a door opened by its own script still stood in the way, and coming back to a room — or loading a
save of it — walled the party in behind a door the snapshot said was open. `SceneState` now knows
which interactables are walk-through-when-open (`kind: 'door'`, and only those: an opened chest
still sits where it sat) and reconciles the index on open and on restore.
