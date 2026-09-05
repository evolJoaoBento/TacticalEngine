# Is this an engine for making Baldur's Gate-style games?

An honest audit against the goal in `CONTEXT.md`: *a full CRPG engine + editor for making
party-based tactical RPGs in the style of Baldur's Gate 3, running on Daggerheart*.

Written 2026-09-05. Updated the same day after the scripting, dialogue, turn-loop and party
slices. Re-check it when the answer changes.

## The short answer

**Getting there.** It can now run a small vertical slice: a party you select between and walk
around, followers that keep up, a trigger that starts a fight, a spotlight that passes back and
forth, and conversations with gated replies and social checks. What it still cannot do is let
someone *author* one without engine code — there is no editor, no character sheet, no
inventory, and no quest model.

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

## What is missing, in the order it should be built

Each item says what it unlocks, because order matters more than the list.

### ~~1. The scripting substrate~~ — done

`script/conditions.ts`, `script/effects.ts`, `script/runner.ts`, `script/world.ts`. Conditions
over flags, keys, scenario variables and world state; the legacy effect vocabulary typed and
extended; and a **stepper** that pauses on an effect needing input rather than forcing async
into the rules core. Everything it does comes back in a journal.

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

### 5. Characters — classes, ancestries, equipment, progression

The vendored SRD has classes, subclasses, ancestries, communities, domain cards, armor and
weapons; the engine models none of them. Equipment matters mechanically here — armor sets the
damage thresholds and Armor Slots the rules already use, weapons set Proficiency dice and range.

### 6. Inventory, loot, gold

The `loot` effect exists as a name only.

### 7. Quests and journal

Listed in `CONTEXT.md`. Needs (1) plus a quest state model.

### 8. The editor

Listed in `CONTEXT.md`, and the thing that makes this an *engine* rather than a game.
`docs/research/legacy-editor-ui.md` §10 already lists the UX gaps to close.

### 9. Asset import (glTF)

Fixtures are vendored (`tests/fixtures/models/*.glb`) and unused. The procedural library was
built spec-first partly so an imported asset can slot in beside it behind one resolver.

### 10. Presentation the prototype had and this does not

Narrative log with entity-hover links, inspector, HUD, camera control (the demo camera is
fixed — BG3 needs orbit, pan and zoom), dice presentation.

## How to tell whether this is on track

A good check at any point: **could someone build a small BG3-like scenario with this and no
engine code?**

With 1–4 done, a scenario *runs*: `tests/unit/demo-scene.test.ts` and `tests/e2e/demo.spec.ts`
walk a party into a vault, fire a trigger, trade blows with an SRD adversary and pass the
spotlight, all from content plus a seed. What is still missing is the ability to **author** one:
characters are three hard-coded literals in `game/demo-scene.ts` rather than sheets built from
the vendored classes and equipment, and there is no editor, inventory or quest model.

So the honest answer today is: *the engine can run a vertical slice; a designer cannot yet make
one.* Item 5 is what closes most of that distance, and item 8 closes the rest.
