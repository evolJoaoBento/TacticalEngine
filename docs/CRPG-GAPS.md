# Is this an engine for making Baldur's Gate-style games?

An honest audit against the goal in `CONTEXT.md`: *a full CRPG engine + editor for making
party-based tactical RPGs in the style of Baldur's Gate 3, running on Daggerheart*.

Written 2026-09-05. Updated 2026-09-06 after the editor and the use-verb slices. Re-check it
when the answer changes.

## The short answer

**Most of the way, for one room.** A designer can author a party, a map, and what the things on
that map do, and play it — no engine code. Select between characters, walk with followers
keeping up, cross a trigger into a fight, pass the spotlight, open a locked chest on a Finesse
roll and read what the author wrote about it.

Nothing on the list is a wall any more. What remains is depth — inventory, quests, progression,
presentation — and tools for the authoring that currently happens in TypeScript literals.

The risk this document exists to name: a Daggerheart rules library with a renderer looks like
progress and is not the goal. BG3 is roughly a third combat. Everything below is the other
two thirds.

## What is done

| Layer | State |
|---|---|
| Rules (SRD 2.0) | Duality rolls, GM die, damage/thresholds/armor, resources, range, cover |
| Grid | Terrain, A*/Dijkstra, line of sight, occupancy |
| Content | SRD adversary importer; legacy map/campaign importer |
| Scene | Authored document (zod), runtime state overlay, JSON save/restore |
| Combat | One attack, end to end, seeded and replayable |
| Render | Instanced terrain, procedural model library, click-to-move demo |
| Characters | SRD classes/ancestries/communities/armor/weapons; sheets deriving the real numbers |
| Scripting | One schema for conditions and effects; a stepper that pauses for input |
| Interaction | Use a thing: keys, locked text, an action roll, effects and prose per outcome |
| Editor | Terrain/height/props/objects/enemies/triggers/spawns, undo, validation, JSON save+load |
| UI | Narrative log with tone, the conversation panel, and the roll prompt a script raises |
| Campaign | Two scenes, travel between them, and state that outlives a room |
| Editor | Map tools, scene list, object inspector, dialogue graph, undo, validation, JSON |

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

That is a claim about the *runner*, not about the game: one effect still lands
in the journal and stops there. `loot` finds something and there is
nowhere to put it (see 6).

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

**Still open:** authoring one in the editor. The graph is data now, so this is a UI job rather
than an engine one.

### ~~3. The turn loop~~ — done

`combat/encounter.ts`. No initiative, as the SRD has none: the party acts until a roll hands the
spotlight over, the GM spotlights one adversary free and spends a Fear for each additional one,
then it passes back. The SRD's optional Spotlight Tracker is a second policy rather than a
different code path. Victory and defeat settle themselves.

### ~~4. Party control~~ — done

`scene/party.ts`. Selection with wrap-around cycling, per-member movement, allies transparent
out of combat and solid in it, and the follow-the-leader trail the prototype had.
`scene/triggers.ts` indexes the map's trigger cells so walking into one starts its encounter and
stops the mover there rather than letting them run past the ambush.

### ~~5. Characters — classes, ancestries, equipment~~ — mostly done

`content/srd/daggersearch.ts` imports the 9 classes, 18 ancestries, 9 communities, 34 armors and
192 weapons; `character/sheet.ts` turns a sheet naming those by id into the numbers the rules
already consume — Evasion and Hit Points from the class, damage thresholds and Armor Slots from
the armor plus level, and an attack profile whose trait, range and dice come from the weapon.
The demo party is three authored sheets rather than three literals.

**Still open:** subclasses, domain cards and progression (levelling, advancements, multiclass).
Those are what item 6 and a future levelling pass need.

### 6. Inventory, loot, gold

The `loot` effect exists as a name only.

### 7. Quests and journal

Listed in `CONTEXT.md`. Needs (1) plus a quest state model.

### ~~11. Scene travel~~ — done

`travelTo` in `game/demo-scene.ts` swaps the per-scene half of the world — scene, grid, state,
pathfinder, party, triggers, script world — and keeps the campaign half. Wounds, Stress, Hope and
the GM's Fear travel with the party; where everyone stood does not, so they arrive on the new
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

**Still open:** the editor cannot create or list scenes (gap 8), and arriving rebuilds the whole
`SceneView` rather than diffing it, which is fine for two rooms and would not be for fifty.

### ~~8. The editor~~ — first pass done

`editor/session.ts` holds a project and every reversible change to it (command-based undo, brush
drags coalesced into one step); `editor/controller.ts` decides what a click means given the tool
in hand; `editor/validate.ts` reports the mistakes a schema cannot catch — a spawn in a wall, a
trigger sealed behind one, an adversary with no stat block, an encounter nothing can start;
`editor/ui/EditorPanel.tsx` is the panel over all of it. Ctrl+E toggles play and edit.

Tools: terrain brush, raise/lower, props, objects, adversaries, trigger cells, spawns, erase,
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
Recursive effects (`branch`, `choice`, a nested `check`) are shown and removable but not
editable — a tree editor is its own job, and silently dropping what it could not represent would
be worse than saying so.

A **dialogue graph** (`ui/DialogueGraph.tsx`) draws a conversation as a tree: node cards on a
pannable surface, links curving from each reply to the node it leads to, a check's success and
failure branches in green and red, and a dangling link drawn as a red stub with the id it cannot
find — the validator's error made visible where it was made. Drag a node, type its lines, add and
rewire replies, give a reply a roll, set which node the conversation opens on.

`layoutDialogue` (in `engine/dialogue/`, DOM-free) places nodes by breadth-first distance from
the start, so a conversation written by hand opens as a readable tree. It never writes the
document: a position is stored only when someone drags a node, so opening a file and moving one
thing is a one-node diff.

**Still open:** camera control (the view is a fixed three-quarter, so a large map cannot be
panned), and a condition editor — a reply's `available`/`enabled` gates are still written in
code.

### 9. Asset import (glTF)

Fixtures are vendored (`tests/fixtures/models/*.glb`) and unused. The procedural library was
built spec-first partly so an imported asset can slot in beside it behind one resolver.

### 10. Presentation the prototype had and this does not — partly closed

The **narrative log** exists (`game/ui/PlayPanel.tsx`): tone-coloured lines, and the prompt a
script raises when it stops for a roll, with the option to step back from it. Text only —
CONTEXT.md rules out narration, and a conversation UI is exactly where that creeps back in.

Still missing: entity-hover links in the log, an inspector, a HUD, camera control (the demo
camera is fixed — BG3 needs orbit, pan and zoom), and dice presentation.

## How to tell whether this is on track

A good check at any point: **could someone build a small BG3-like scenario with this and no
engine code?**

A scenario *runs*: `src/game/demo-scene.test.ts` and `tests/e2e/demo.spec.ts`
walk a party into a vault, fire a trigger, trade blows with an SRD adversary and pass the
spotlight, all from content plus a seed. What is still missing is the ability to **author** one:
characters are three hard-coded literals in `game/demo-scene.ts` rather than sheets built from
the vendored classes and equipment, and there is no editor, inventory or quest model.

A designer can now author a *party* (sheets naming a class, ancestry, armor and weapon), a
*map* (terrain, elevation, props, objects, enemies, triggers and spawns, saved as JSON and
loaded back), and *what the things in it do* — a check, its difficulty, and effects and prose
per outcome, all as document data the engine executes. None of it needs engine code.

Conversation is authorable too, as of this pass: the demo's pillar holds a five-node
conversation with a reply hidden until the party knows the Warden's name and a reply that costs
a Presence 13, and the whole thing is document data that survives Save JSON.

What is left of the authoring gap is a *tool* for the writing rather than the writing itself —
today a conversation is a literal in `game/demo-dialogue.ts` that happens to parse through the
schema, which is the same position maps were in before the editor.

So the honest answer today is: *a designer can build the party, the place, what everything in it
does, what it says, and the way between rooms — all of it in a tool.* What is left is depth
rather than authoring: things to carry, quests to track, characters who grow, and a camera that
moves. The line has moved past authoring. What is left is what a
campaign needs to be more than a demo: inventory and loot (6), quests (7), progression (5), and
a camera someone can actually look around with (10).

One thing worth knowing before that work: `buildDemoScene` force-opens the vault door, a
workaround from when nothing could use a door. It can go now — the party can pick that lock
themselves — but the combat e2e walks east through it, so that is its own change.
