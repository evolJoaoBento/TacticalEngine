# Is this an engine for making Baldur's Gate-style games?

An honest audit against the goal in `CONTEXT.md`: *a full CRPG engine + editor for making
party-based tactical RPGs in the style of Baldur's Gate 3, running on Daggerheart*.

Written 2026-09-05, after seven slices. Re-check it when the answer changes.

## The short answer

**Not yet.** What exists is a correct, well-tested *tactical rules and map engine*: it can
resolve Daggerheart, path a grid, hold a scene, and draw it. What it cannot do is the half of a
CRPG that is not combat — talking, choosing, questing, carrying things, growing a character —
and it cannot yet run a *turn*.

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

### 1. The scripting substrate — conditions, effects, events

**Nothing in the engine can currently make content *do* something.** `SceneDoc` already
declares an `Effect` vocabulary (`open`, `giveKey`, `setFlag`, `startEncounter`, `goto`…) and
`Interactable.check` already declares an action roll with per-outcome text — and no code reads
either. That is the single biggest gap, because dialogue, quests, triggers, interactions and
encounters are all the same machine underneath: *evaluate a condition, run an effect list,
sometimes stop and ask the player something.*

Needs: a condition language over scenario variables, flags, keys and world state; an effect
executor that journals what it did; and a stepper that can pause on an effect requiring input
rather than forcing async into the rules core.

### 2. Dialogue graphs

The most BG3-shaped feature there is, and the one with nothing behind it. Nodes, speakers,
lines, choices gated by conditions, choices that cost a roll (a Presence check to intimidate),
and effects on choosing. Rides entirely on (1).

### 3. The turn loop

Combat is *resolvable* but not *playable*: no encounter start or end, no spotlight, no notion
of whose turn it is. `duality.ts` already reports `spotlightToGm`; nothing consumes it.

### 4. Party control

BG3 is a party game. Today the demo moves one "leader". Needs: selection, per-character action
budgets, follow-the-leader out of combat, and the party carrying between scenes.

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
engine code?** Today the honest answer is no — they could build a map and a fight, and could
not write a single line of dialogue or a single quest. When items 1–4 are done the answer
becomes "a vertical slice, yes", and that is the milestone worth aiming at.
