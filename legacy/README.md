# ⬡ Tactical Engine — Tactical RPG

A low-poly tactical RPG with a rich narrative text pane, powered by an adaptation of the
**Daggerheart** duality-dice system. Includes a full **Map Creator Suite** and a complete
scripted one-shot campaign: **★ The Conductor's Stage**.

## ★ One-Shot Campaign — "The Conductor's Stage"

Click **★ One-Shot** in the top bar. Three phases:

1. **Waking Up** — you are four formless spirits in a silent war camp ringed by looping fog.
   Click the dead bodies to inhabit them; each plays its death-memory flashback (PT), wakes
   with one glowing spirit eye, and grants a unique once-per-scene **Spirit Blessing**
   (✦ button on the hero card): Cinder Nova, Hearthlight, Hoarfrost Bind, Shield Wall.
2. **The Pit** — bound fey spectators, a forced duel, and the Archfey's proclamation.
   **Three paths**: descend the stairs and fight the Tangle Bramble Swarm in the arena
   (*Entertained*); take the Shadow Hag's bargain — trade all blessings for the crank
   locations and a backdoor (*Insulted*); or kill the Hag for her Moon Staff (+1 party
   damage, locations known, *Vengeful*).
3. **The Theater** — the Archfey sits immune behind a starlight barrier. Find the **4 hidden
   crank handles** (piano strings, loose floorboard, weeping spectator, prop trunk), light
   the **4 spotlight pillars**, and pass a Knowledge/Finesse DC 13 roll to align the beams
   on his throne. Arena path: he recites riddles on every Fear roll and *puppets your heroes
   into sabotaging lit pillars*. Skip paths: no riddles — but he puppets heroes into attacking
   their allies while brambles tear out of the seats. Three different endings + outro.

Campaign monsters use real Daggerheart-style kits: brambles **entangle** (stacking slows),
the Hag casts **Waking Nightmare** (drains Hope at range, heals herself) and fights at range.

## Run it

ES modules need a local server (double-clicking `index.html` won't work):

```
start.bat          # Windows: serves on http://localhost:8420 and opens the browser
```

or manually: `python -m http.server 8420` (or `npx http-server -p 8420`) in this folder,
then open http://localhost:8420. Requires internet on first load (three.js / cannon-es from CDN).

## 🔍 Right-Click Inspect

Right-click anything on the map for a full readout: heroes (HP, Hope, traits, weapon,
blessing), enemies (stat block, specials, hostile/dormant status), nodes (check trait/DC,
state), scenery (flavor descriptions), and tiles (elevation, terrain effects). Esc or
right-click elsewhere closes it. (In the editor, right-drag stays camera rotate.)

## The Duality Dice

Every check rolls **two physical d12s** — gold **Hope** and violet **Fear** — simulated with a
rigid-body physics engine. **Click and drag, then release to fling them across the live map**;
they carom off terrain blocks, pillars, and the miniatures themselves.

`Total = Hope d12 + Fear d12 + trait modifier` vs Difficulty:

| Result | Meaning |
|---|---|
| **Critical** (dice match) | Success, +1 Hope, momentum |
| **Success with Hope** (Hope die higher) | You get it, +1 Hope |
| **Success with Fear** (Fear die higher) | You get it — but the GM gains Fear and complications follow |
| **Failure with Hope** | Miss, but +1 Hope consoles you |
| **Failure with Fear** | Miss, GM gains Fear, things get worse |

- **Hope** (per hero, max 6): spend 1 before any roll for **+2**.
- **Fear** (GM pool): at 4+, the GM spends it during the enemy phase for an attack surge.

**Party movement:** out of combat the party moves as a group — move the selected hero and
the others trail behind along the same path (they pass through each other freely, never
stack, and stop short of combat trigger zones). In combat everyone moves individually.

**Terrain & movement feel:** the ground is one continuous low-poly heightfield (vertex-
colored, faceted, gently uneven) — only tall structures like walls, curtains, and balconies
stay as crisp blocks. Movement is freeflow: paths are string-pulled into straight lines and
tokens glide smoothly across the terrain, facing their direction of travel, instead of
hopping square by square. Rules (move costs, difficult terrain, climb limits, cover, high
ground) still resolve on the underlying grid. The camp's fog wall in the one-shot is real
drifting volumetric fog.

## Combat — Action Tracker, not initiative

No fixed turn order. The party shares a pool of **action tokens** (heroes alive + 1).
Moving, attacking, or using a node costs 1. The enemy phase triggers when:

1. the pool empties, **or**
2. **any roll lands with Fear** — the enemy seizes the moment immediately.

Tactical modifiers: **high ground** +1 to hit, **cover** +2 Evasion / +2 Difficulty,
**difficult terrain** doubles movement cost.

## Text ↔ Grid link

Blue underlined words in the narrative log are live references — **hover them and the
matching 3D object flashes** on the tactical map. Hovering map objects shows their stats
in the context bar.

## Campaign Builder (✎ Editor)

The editor is a full campaign builder, not just a map painter:

- **Scenes** — a campaign is an ordered list of maps. Add / rename / delete scenes in the
  SCENES panel; each scene has its own size (8–48 per side via **⤢ Size**), intro text
  (**📜 Intro**), terrain, encounters, and scripts. Save/Load moves the whole campaign as
  one JSON file (legacy single-map files import fine).
- **Portals (⊙)** — link scenes like the one-shot's gates: a portal node travels the party
  (HP, Hope, keys, flags all carry over) to its target scene. Defaults to the next scene;
  retarget it via Inspect.
- **Roll conditions & scripted effects** — every node outcome (the 4 Daggerheart roll
  states) can now also fire a mechanical effect: *give key*, *set story flag*, *start
  combat group N*, *travel to scene*, plus the classics (open, loot, trap, destroy).
  Nodes can **require a key** to be used at all, with custom locked-out text — so "the
  chest's Success-with-Hope gives the Bone Key, which unlocks the sealed gate to Scene 2"
  is pure data, no code.
- **Walls (▮)** — drag-paint solid impassable walls (paint again to erase); raise/lower now
  goes up to height 8 for multi-tier builds.

## Map Creator Suite (✎ Editor)

1. **Terrain & Grid Sculpting** — Raise/Lower drag-brush, color painting, tile properties
   (Difficult Terrain, Cover). High ground is automatic from elevation.
2. **Interactive Nodes** — drop chests, doors, crumbling pillars. Doors and pillars block
   movement until opened/destroyed.
3. **Skill-Check Scripting** — *Inspect* a node to set its flavor text, Daggerheart trait
   (Agility/Strength/Finesse/Instinct/Presence/Knowledge), DC, and a custom narrative +
   mechanical effect for **each of the four roll states**.
4. **Encounters & Triggers** — place enemies by type (**Hollow Husk, Tangle Bramble,
   Shadow Hag** — full stat kits incl. specials) in groups (1–4) and paint invisible
   trigger zones; stepping into a zone snaps the game from exploration into combat.
5. **Decor Palette** — every campaign model is reusable scenery: tents, campfires (with
   real point light), pianos, prop trunks, thrones, bound spectators, hags' huts, starlight
   barriers, gates. Click to place, click again to rotate, Erase to remove.

All miniatures come from a shared model library (`js/models.js`) — heroes (knight, rogue,
mage, battle mage, frost mage, village defender) and monsters are proper low-poly figures
with bases, gear, glowing bits, and spirit-eye support. Add a builder there and it appears
in the game, the campaign, and the editor palettes automatically.

Maps save to **JSON** (`Save` downloads, `Load` imports) and auto-persist to localStorage.
`▶ Play` instantly playtests the current map on a clone — the editor master is never mutated.

Camera: left-drag rotates (play) / right-drag rotates (editor), wheel zooms.

## Stack

| Component | Tech |
|---|---|
| Rendering | three.js — flat-shaded low-poly, real-time shadows |
| Dice physics | cannon-es — convex-polyhedron d12 rigid bodies |
| UI | Vanilla HTML5 overlay (no build step) |
| Data | Plain JSON map schema |
