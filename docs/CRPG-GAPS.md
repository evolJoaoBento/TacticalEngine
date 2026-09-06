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

The two things that keep it from being a game rather than a scene:

1. **Nothing talks.** The dialogue runtime is built and tested, but a `Dialogue` is not part of
   the saved project, so it cannot be authored or shipped (item 2).
2. **There is only ever one room.** `goto` names a scene and nothing ever changes scene
   (item 11).

Everything else on the list is depth — inventory, quests, progression, presentation — rather
than a wall.

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
| UI | Narrative log with tone, and the roll prompt a script raises |

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

That is a claim about the *runner*, not about the game: three effects still land
in the journal and stop there. `goto` names a scene and nothing changes scenes
(see 11); `loot` finds something and there is nowhere to put it (see 6);
`startDialogue` names a conversation that cannot be saved (see 2).

`scene/interact.ts` is the verb that was missing: reach a thing, and its authored `requiresKey`,
`lockedText`, `check` and outcomes actually happen. The legacy vault's own furniture — a Finesse
13 door, a trapped chest, a Strength 12 pillar, every line of prose written by the original
author — plays through it.

Two known simplifications, both in `game/demo-scene.ts` rather than the engine: a check rolls
with the *best* trait in the party rather than the acting character's, because
`SceneScriptWorld` takes one traits map at construction; and using something in a fight spends
that character's action, which is a choice rather than a rule read out of the SRD.

### ~~2. Dialogue graphs~~ — done

`dialogue/dialogue.ts`. Speakers, lines, replies gated by conditions, replies that cost a roll
and route by its outcome, effects on choosing. `danglingLinks` and `unreachableNodes` catch
authoring errors before runtime.

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

### 11. Scene travel

`ProjectDoc` holds `scenes[]` and a `startScene`, an interactable can name a `goto`, and the
runner journals it — but nothing in play ever changes scene, so a portal marks itself used and
leaves the party where it stood. A campaign of one room is not a campaign.

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

**Still open:** a scene list and scene creation in the UI, a properties panel for editing an
object's check and outcomes, dialogue authoring, and camera control (the view is a fixed
three-quarter, so a large map cannot be panned).

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

What is left of the authoring gap is **conversation**. `dialogue/dialogue.ts` runs a graph,
`danglingLinks` and `unreachableNodes` check one — but a `Dialogue` is not part of `ProjectDoc`,
so it cannot be saved, and `startDialogue` is journalled rather than run. Until that closes,
dialogue is the one thing that still lives only in TypeScript.

So the honest answer today is: *a designer can build the party, the place, and what everything
in it does — except talk.* Putting dialogues in the project document, making `startDialogue`
pause the runner the way a check does, and an editor over the graph is the next thing that moves
that line.

One thing worth knowing before that work: `buildDemoScene` force-opens the vault door, a
workaround from when nothing could use a door. It can go now — the party can pick that lock
themselves — but the combat e2e walks east through it, so that is its own change.
