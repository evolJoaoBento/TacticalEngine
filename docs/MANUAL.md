# PolyHeart Engine — User's Manual

Everything below is taken from the code and docs in this repository as they stand. Where a
detail could not be confirmed from source it is marked **not verified**.

## 1. What PolyHeart is

PolyHeart is a browser-based engine and editor for party-based tactical RPGs in the style of
Baldur's Gate 3, running on the Daggerheart tabletop rules (SRD 2.0): duality dice, Hope and
Fear, Stress, damage thresholds, Armor Slots, classes, subclasses, ancestries, communities,
domain cards, adversaries, and milestone levelling. A project is a JSON document — scenes,
objects, conversations, quests, items, loot tables — that the engine executes directly, so a
designer builds a scenario in the editor without writing engine code.

It ships with a small two-room demo campaign (placeholder fiction) that exercises the whole
loop: walk, talk, roll, fight, loot, travel, save, level up. Everything is text on screen, and
all content text is English.

### Running it

```
npm install
npm run dev          # Vite dev server on http://127.0.0.1:8420 — open that URL
npm test             # Vitest unit tests (node, no browser)
npx playwright test  # end-to-end tests; Playwright starts its own server on port 8421
npm run typecheck    # tsc --noEmit
npm run check        # typecheck + unit + e2e
```

The original prototype still runs from `legacy/start.bat` (it also serves on port 8420, so do
not run both at once). Do not edit anything under `legacy/`.

A debug handle, `window.__polyheart`, is attached to the page for the end-to-end tests. It
exposes selection, movement, attacks, the log, save/load, editor tools, undo, and project export;
modders and test authors can drive the game through it, but nothing in the engine reads it.

## 2. Playing

The page opens in **play mode** on the demo project's start scene. `Ctrl+E` (or `Cmd+E`)
switches between play and edit at any time.

### Controls

| Input | Play mode | Edit mode |
|---|---|---|
| Left click | Party member: select. Adversary: attack with the selected character. Object: use it. Ground: walk there. | Apply the current tool to the tile |
| Left drag | Orbit the camera | Paint / drag with the current tool |
| Right or middle drag | Pan the camera | Pan the camera |
| Right click (still) | Inspect what is under the pointer: a card with a character's pools, Evasion and gear, an adversary's tier, role and Difficulty, or an object's kind, state and the roll it asks for | — |
| `Escape` | Close the inspect card | — |
| Mouse wheel | Zoom | Zoom |
| `W A S D` / arrow keys | Pan (held; smooth) | — |
| `Q` / `E` | Turn the camera | — |
| `F` | Frame the selected character | — |
| `Home` | Frame the whole room | — |
| `Tab` | Select the next party member (wraps) | — |
| `Space` / `Enter` | End the party's turn: the GM acts | — |
| `Ctrl+Z` / `Ctrl+Shift+Z` | — | Undo / redo |
| `Ctrl+E` | Switch to edit | Switch to play |

A press that moves less than six pixels counts as a click; anything longer is a drag. The tile
under the pointer is marked so a click has a visible target. The camera keys (WASD, arrows,
Q/E) are ignored while a text field has focus; the other keys are not (see Limits).

### The screen

- **HUD** (bottom left): one card per party member — name, class, and pips for HP, Stress,
  Armor, and Hope (each box one slot, filled when marked), any conditions, and a line naming
  what they wield and wear. The selected card has a blue border; a fallen member is dimmed.
  Clicking a card selects that character. A yellow **Level up** button appears on a card when
  a level is waiting (see Levelling up). The last card shows the GM's **Fear** pips and either
  "Exploring" or "Round N".
- **Play panel** (bottom right), top to bottom:
  - **Save / Load** buttons.
  - **Journal**: every quest the party has been given. Active quests show their summary and
    their steps as ☐ / ☑; completed quests are struck through; failed ones say "— failed".
    Finished quests sink below active ones.
  - **Carried**: the party's shared pack, with counts (×N). A weapon or armor item that points
    at SRD gear shows an **Equip** button.
  - **Log**: the narrative log, most recent twelve lines, coloured by tone (see tones in §4).
  - **Conversation**: speaker-tagged lines and reply buttons when a conversation is open;
    a **Continue** button when a node has no replies.
  - **Roll prompt**: "Roll finesse +2" / **Step back** when a script is waiting on a roll;
    a list of option buttons when a script asks for a choice.
  - **Use what is in reach**: shown when the selected character stands next to an object.

### Turns: exploring and fighting

Out of combat there are no turns. Click the ground to walk the selected character; the others
follow in a trail. Walking onto a trigger cell starts that cell's encounter and the mover stops
on the trigger rather than running past the ambush.

In a fight there is no initiative. The party acts until an action roll hands the spotlight to
the GM; each member's move or attack spends their action for the exchange. Press `Space` or
`Enter` to play the GM's turn: the GM spotlights one adversary free and spends a Fear for each
further one while Fear lasts; each spotlighted adversary attacks the nearest party member it
can reach. Then the spotlight returns to the party. Victory and defeat settle themselves.

Attack results are shown by the HUD pips changing, not by a log line; a click on an adversary
that cannot be attacked (out of range, already acted) does nothing visible. Only scripted rolls
(checks on objects and in conversations) are read out in the log.

### Using things

Stand next to the object (one tile, diagonals count) and either click it or press **Use what
is in reach**. Out of reach reads "It is out of reach." Using something in a fight spends that
character's action ("There is no time — you have acted."). An object that needs a key the party
lacks prints its locked text. Otherwise its roll-free effects run, then its check, if any, asks
for a roll. An object that starts a conversation opens it here. A used pillar or opened chest
refuses a second use.

### Conversations

A conversation shows its lines and the replies you may give. A reply can be hidden until the
party knows something, shown but greyed ("Not available"), cost a roll (the roll prompt appears
inside the conversation), or end the conversation. A node's lines are also written to the log.
Everything else — walking, using, saving, levelling — waits until the conversation ends.

### Rolls

An action roll is two d12: the Hope die and the Fear die, plus the trait modifier, against a
Difficulty. The log reads it out, naming only the parts that applied:

    Hope 8 + Fear 7 + 2 = 17 vs 12. Success, with Hope.

Extra parts appear as `+ d6 N` / `− d6 N` (advantage or disadvantage) and `+ help N`. The five
outcomes are critical success (both dice match), success with Hope, success with Fear, failure
with Hope, failure with Fear. **Step back** declines the roll at no cost: the outcome lists
and `always` are skipped, any effects written after the check still run, and the object can be
tried again. In this build a
scripted check rolls with the *best* modifier for that trait in the whole party, not the
selected character's (see Limits).

### Loot, keys, equipping and using

A `loot` effect draws from a weighted table with the scene's own dice, so a chest's contents are
as replayable as the roll that opened it. Drops read "You find 7 Gold and a Brass key." and go
into the shared pack. Keys are items: a door that "requires key X" is satisfied by carrying one
item with id X.

**Equip** puts a carried weapon or armor item on the *selected* character. The item leaves the
pack; what it replaced returns to the pack if the project has an item for it. Evasion, damage,
thresholds and Armor Slots are re-derived; nothing marked is cleared. Armor cannot be changed
during a fight; a weapon can.

**Use** runs a consumable's `use` effects with the *selected* character as the actor — the
demo's healing draught clears 2 marked Hit Points. The item is spent before its effects run,
so a use script that stops to ask something (a roll, a choice) has already consumed it even if
you cancel. In a fight, using something is that character's action, and nothing can be used
while a prompt is waiting or during the GM's turn. An item with no `use` effects has no Use
button.

### Travel

A portal (the demo's stairs) carries a `goto` effect. Travel happens once the script that
asked for it has finished asking you things. Wounds, Stress, Hope and the GM's Fear travel with
the party; positions do not — you arrive on the new scene's spawns. A room you return to is as
you left it (open chests stay open; adversaries stand where they stood), and the scene's intro
text is logged on arrival. Walking out abandons a fight.

### Saving

Saves are named slots in the browser's `localStorage`. **Save** writes the quick slot
(overwritten each time); **Save as…** asks for a name and makes a new slot; **Load** opens the
list — newest first, with where the party was — and each entry can be loaded or deleted. An
**Autosave** slot is written whenever the party changes rooms. Both save buttons are greyed
during a fight ("Not in the middle of a fight.") and while any prompt is waiting — a roll, a
choice or a conversation ("Not in the middle of a conversation."), because a running encounter
and a paused script hold live objects the save format cannot serialise. A save is a checkpoint
between beats.

A save records: the scene being played, every visited room as it was left, where everyone
stands, the pack, flags and variables, quest progress, the party's sheets (levels and gear),
the whole log, the selected character, and the position of the dice stream (so a reload does
not re-roll numbers already spent). It is *state over a project*, not a copy: edit the map and
the save follows the new map. **Load** refuses a save from another project, one naming a scene
the project no longer has, and damaged text — the reason is logged. Loading puts the party back
on the tiles they stood on, not the spawns.

### Levelling up

Daggerheart has no experience points; a `levelUp` effect placed by the designer grants the
party a level (the demo grants one when the strongbox opens). "The party reaches level 2."
appears in the log and a **Level up** button appears on every card whose sheet is below the
party level — but not during a fight or an open prompt.

The sheet for "Kara — level N" asks for:

- **Advancements** — exactly 2 picks. Each option shows boxes left in this tier and whether
  it "costs both picks". Picking one adds a row where its detail is chosen (the two traits,
  the two Experiences, the extra card, the multiclass class and domain).
- **New domain card** — one, from the character's domains at or below the new level, not
  already held. The card's text is shown.
- **New Experience (+2)** at levels 2, 5 and 8, when Proficiency also rises by one.

**Take level N** applies the plan whole or not at all; refusals from the engine are listed in
red. **Later** closes the sheet; the button stays until the level is taken. Pools grow without
clearing a mark. The grown sheet travels between rooms and into the save.

## 3. The editor

Press `Ctrl+E`. The panel on the left shows the scene being edited (name and size, "unsaved"
when the project has changes), **▶ Play**, **Undo**, **Redo**, then the sections below. In edit
mode the view follows the scene being edited, which need not be the room the party is in;
browsing scenes never moves the party or abandons their fight.

### Tools

| Tool | What a click or drag does |
|---|---|
| Inspect | Click an object to open its inspector below (selecting is not an undo step) |
| Terrain | Drag to paint the chosen terrain id; brush 1×1, 3×3 or 5×5. Painting a wall stops movement but reads as dark floor until raised |
| Raise / Lower | Drag to change elevation by one level; same brushes. One drag is one undo step |
| Prop | Click to place the chosen prop model; click the same model again to turn it 90° |
| Object | Click to place a chest, door, pillar or portal (chosen below the tools); clicking an existing object with this tool **removes** it |
| Enemy | Click to place the chosen SRD adversary (dropdown) in the scene's encounter; an encounter is created if there is none |
| Trigger | Click to toggle a cell that starts the encounter |
| Spawn | Click to toggle a party start tile |
| Erase | Click removes the prop on the tile first, then the object under it |

### Scenes

The **Scenes** list shows every scene with its size; **▸** marks the scene the project opens on
and **●** the one the party is in. Click a scene to edit it; **✎** renames it (a browser
prompt); **▸** makes it the start scene; **✕** deletes it (refused for the start scene or the
last scene, after a confirm). **+ Scene** adds a blank 12×10 room and opens it. "This scene"
counts props, objects, enemies and spawns.

### Objects and the inspector

With Inspect, click an object. The inspector edits:

- **What it is** — Name; Flavour (read when used); Kind (chest, door, pillar, portal,
  scripted — only a door stops blocking its tile when opened); Blocks movement.
- **Getting in** — the key it needs (an item id; blank for none) and the line shown without it.
- **What it does** — effects that run with no roll, before any check.
- **The roll** — **+ Ask for a roll** adds a check (trait, Difficulty), then an effect list for
  each of the five outcomes. An outcome left empty falls back (see §4, Checks).
- **Danger** — delete the object.

Every keystroke is an undoable session edit, coalesced per field.

### Effect lists

An effect list shows each effect with a one-word label and its fields, **✕** to remove, and
**+ Add an effect…** offering: Say something, Set a flag, Clear a flag, Give a key, Open it,
Remove it, Mark it used, Give loot, Deal damage, Heal, Start a fight, Travel to a scene, Start a
conversation, Start a quest, Complete an objective, Complete a quest, Fail a quest, Level the
party up. Scene, conversation, encounter and quest ids are dropdowns over what the project holds;
the objective dropdown follows its quest. Flag, key and loot-table ids are typed.

**If … then** adds a `branch`: a condition editor for its `when` (kind from a dropdown; quest,
objective and encounter ids from dropdowns; flags, items and variables typed; `not`/`all`/`any`
nest), then two effect lists for *then* and *otherwise*. **Reveal an objective** brings a hidden
quest step into the journal.

**Ask for a roll** adds a `check` with the same editor an object's roll uses — trait,
difficulty, prompt, and an effect list per outcome. **Ask the player** adds a `choice`: a title,
what the player is told, and options, each with a label, an optional *if…* gate and its own
effect list. **Story panel**, **Set/Add a variable**, **Give/Take an item** and **End a fight**
are edited inline. Every effect kind the engine runs can now be built in the editor.

### Conversations (the graph)

**Conversations** lists each dialogue with its node count; **+ Conversation** asks for an id
and creates a one-node dialogue; **✕** deletes one. Clicking a conversation opens the graph
over the whole view:

- Node cards on a pannable surface (drag the background to pan, drag a card to move it; a
  position is only written to the document when a node is dragged). The start node has a
  yellow border and ▸. **+ Node** adds one near the view; **Close** returns to the panel.
- Links curve from each reply's row to its target: grey for a node's own `goto`, blue for a
  reply, green / red for a check's success / failure route. A link to a node that does not
  exist is a red dashed stub labelled `id?`.
- ▸ on a card opens it for editing: line text, **+ Line**, reply text, a reply's destination
  (or "— ends the conversation —"), **Costs a roll** with trait and Difficulty, **+ Reply**,
  **Open here** (make this the start node), **Delete**, and **On entering this node** effects.

A reply can be gated: **if…** adds an `available` condition (the reply is hidden unless it
holds), **only if…** an `enabled` one (shown greyed unless it holds); each opens the condition
editor under the reply, and **✕** removes the gate.

A reply's roll shows its outcome effect lists and the nodes a success and a failure lead to
(**on success** / **on failure**).

Not editable in the graph (JSON only): a line's `speaker`, a reply's `detail`, a reply's own
`effects`, and
`gotoOnFailure`.

### Quests

**Quests** lists each quest with its step count. **+ Quest** asks for a name (the id is derived
from it) and creates a one-step quest. Click a quest to open its form: name, summary (what the
journal says), and each step's id and text with a **hidden** box (the step stays out of the
journal until a `revealObjective` effect shows it or it is completed), **✕** (a quest keeps at
least one) and **+ Step**.

### Models (glTF import)

A **Models** section lists the project's imported models (id and URL). **+ Model** asks for a
`.glb`/`.gltf` URL (relative URLs resolve against the page) and a scale (a tile is one unit);
the id is derived from the file name. **✕** removes one. Content refers to an imported model by
id exactly as it refers to a built-in one — a deco's or an object's `model` field, or an
entity's definition — and the view draws the built-in placeholder until the file has loaded. The Prop palette still lists only
the built-in library, so placing an imported model from the UI is **not verified**; the
end-to-end test places it through the debug handle.

### Items and loot tables

There is no editor UI for items or loot tables. Author them in the project JSON (`items`,
`lootTables`); the inspector's loot effect names a table by id, and validation catches a name
that does not exist.

### Validation

**Check** runs the validator and lists up to 30 problems, errors in red and warnings in yellow,
under a summary line. Errors: schema failures; a spawn or adversary in impassable terrain; an
adversary with no stat block; an effect or object travelling to, starting, drawing from, or
naming a scene, encounter, conversation, loot table, item, quest or objective that does not
exist; a loot table dropping something that is not an item; a conversation going to a missing
node. Warnings: an object sharing a tile with another; a model the library lacks; an empty
encounter; an object no path from a spawn can reach; a conversation node nothing reaches; a
quest nothing starts; an objective nothing completes.

### Saving and loading a project

**Save JSON** downloads `<project-id>.json` (the whole document, pretty-printed) and clears the
"unsaved" mark. **Load** opens a file picker; the file is parsed through the project schema.
Loading replaces the document the *editor* holds and redraws the view; it does **not** restart
play — the running game keeps the project it booted with (the built-in demo). A file that fails
the schema is recorded in `__polyheart.errors`, and nothing is shown in the panel.

### Undo

Every editor change goes through one command history: brush strokes coalesce per drag, typing
coalesces per field, graph drags are one step each. `Ctrl+Z` / `Ctrl+Shift+Z` or the buttons;
the buttons' tooltips name the step.

## 4. Content reference

### Project document

`formatVersion` (1) · `id` · `name` · `terrainPalette?` (id, name, passable, cost,
providesCover, blocksSight) · `scenes[]` · `dialogues[]` · `items[]` · `lootTables[]` ·
`quests[]` · `startScene`. All ids are stable kebab-case strings; duplicates are rejected.
`assets[]` holds imported models (`id`, `kind` 'gltf', `url`, `scale`, `groundOffset`,
`rotationY`).

A **scene**: `id`, `name`, `intro` (logged on arrival), `width`, `height` (≤ 512), `terrain[]`
(terrain ids, row-major), `heights[]`, `tints[]?` (per-tile CSS colour, presentation only),
`spawns[]` (≥ 1), `interactables[]`, `encounters[]`, `decos[]`, `fogBand?`.

An **interactable**: `id`, `kind` (chest | door | pillar | portal | scripted), `position`,
`name`, `flavor`, `model` (null = invisible), `blocksMovement`, `effects[]`, `check?`,
`requiresKey?`, `lockedText`, `goto?`, `tags[]`, `data{}`.

An **encounter**: `id`, `name`, `adversaries[]` (`id`, `adversary` = SRD adversary id,
`position`, `name?`, `hitPoints?`), `triggerCells[]`, `startsOnTrigger`. A **deco**: `model`,
`position`, `rotation` (radians), `id?`.

Log tones: `narration` (default text), `system`, `hope`, `fear`, `combat`, `success`.
Traits: agility, strength, finesse, instinct, presence, knowledge.
Target selectors: `{kind:'actor'}` (whoever used the thing; the default), `{kind:'party'}`
(living members), `{kind:'entity', id}`.

### Conditions

| kind | fields | true when |
|---|---|---|
| `always` / `never` | — | always / never |
| `not` | `of` | the inner condition is false |
| `all` | `of[]` | every inner condition holds |
| `any` | `of[]` | at least one holds |
| `flag` | `flag` | the campaign flag is set |
| `hasKey` | `key` | the party carries one of item `key` |
| `hasItem` | `item`, `quantity?` (1) | the pack holds at least `quantity` of the item |
| `var` | `name`, `op` (== != < <= > >=), `value` | the scenario variable compares so |
| `interactable` | `id`, `state` (used \| open \| removed) | that object is in that state |
| `encounter` | `id`, `state` (started \| ended \| triggered) | that encounter is in that state |
| `quest` | `quest`, `status` (inactive \| active \| completed \| failed) | the quest stands so |
| `objectiveDone` | `quest`, `objective` | that step is ticked |
| `partyAlive` | `op`, `value` | living party count compares so |
| `adversariesAlive` | `op`, `value` | living adversary count compares so |

### Effects

| kind | fields | what it does |
|---|---|---|
| `none` | — | nothing |
| `log` | `text`, `tone?` | writes a line to the log |
| `story` | `title`, `paragraphs[]`, `button?` | logged as one line: title then paragraphs (`button` is not used by this UI) |
| `setFlag` / `clearFlag` | `flag` | sets / clears a campaign flag (not logged) |
| `giveKey` | `key` | adds one of item `key`; logs "You take the …" |
| `addItem` / `removeItem` | `item`, `quantity?` (1) | changes the pack |
| `setVar` | `name`, `value` | sets a scenario variable (string, number, boolean or null) |
| `addVar` | `name`, `by` | adds to a numeric variable |
| `open` / `remove` / `markUsed` | `interactable?` | changes that object's state; default is the object the script ran from. An opened door stops blocking |
| `loot` | `table?` | draws from the table into the pack and logs the drops; no table finds nothing |
| `damage` | `amount`, `target?`, `source?` | marks Hit Points on the target(s) (default: the actor); can fell them |
| `heal` | `amount`, `target?` | clears Hit Points; brings a fallen character back up |
| `startEncounter` | `encounter`, `intro?` | starts a fight; logs `intro` or "Something moves." |
| `endEncounter` | `encounter` | marks the encounter ended |
| `goto` | `scene` | travel, taken once the script has stopped asking |
| `startDialogue` | `dialogue` | pauses the script, runs the conversation, then resumes |
| `startQuest` | `quest` | starts it (idempotent); logs "New quest: …" |
| `completeObjective` | `quest`, `objective` | ticks a step (starts the quest if needed); logs "Objective complete: …" |
| `revealObjective` | `quest`, `objective` | brings a hidden step into the journal (starts the quest if needed); logs "New objective: …" |
| `completeQuest` / `failQuest` | `quest` | ends the quest; logs "Quest complete/failed: …". Ticking the last step does not complete a quest by itself |
| `levelUp` | `level?` (2–10) | raises the party level to `level` or by one; never lowers it |
| `branch` | `when`, `then[]`, `otherwise[]?` | runs one list depending on a condition |
| `choice` | `title?`, `body?`, `options[]` (`label`, `detail?`, `available?`, `effects[]`) | pauses for the player to pick an option |
| `check` | `check` | pauses for a roll (below) |

### Checks

`trait`, `difficulty`, `prompt?`, and effect lists `onCriticalSuccess`, `onSuccessWithHope`,
`onSuccessWithFear`, `onFailureWithHope`, `onFailureWithFear`, `always` (runs after the outcome
list). Fallbacks when a list is missing: critical → success with Hope → success with Fear; each
success falls back to the other success; each failure to the other failure. Writing one success
and one failure list therefore covers all five.

### Dialogue

A **dialogue**: `id`, `start` (node id), `nodes[]`. A **node**: `id`, `position?` (canvas
x/y), `lines[]` (`speaker?`, `text`), `onEnter[]?` (effects run before the lines show),
`choices[]?`, `goto?` (next node when there are no choices; omitted ends). A **choice**: `text`,
`detail?` (hint shown after a dash), `available?` (hidden when false), `enabled?` (greyed when
false), `check?` (a check plus `gotoOnSuccess?` / `gotoOnFailure?`), `effects[]?`, `goto?`
(omitted ends the conversation). Duplicate node ids and a `start` naming no node are rejected.

### Quests

`id`, `name`, `summary`, `objectives[]` (`id`, `text`, `hidden` default false; ≥ 1, unique
ids). A hidden objective is kept out of the journal until a `revealObjective` effect shows it or
it is completed. There are no stages and no dependencies between steps. Progress lives in
campaign state, not in the document.

### Items and loot tables

An **item**: `id`, `name`, `kind` (key | consumable | weapon | armor | trinket; default
trinket), `description`, `contentId?` (the SRD weapon or armor id it stands for — required for
Equip), `stackable` (default true). A **loot table**: `id`, `rolls` (draws; default 1),
`entries[]` of `item`, `quantity` (a number or `{min,max}` rolled per draw; default 1),
`weight` (relative within the table, default 1; not a percentage). Same-item drops stack.

### Character sheets

A sheet names content by id and everything mechanical is derived: `id`, `name`, `level`,
`classId`, `ancestryId?`, `communityId?`, `traits` (six modifiers), `proficiency`,
`primaryWeaponId?`, `secondaryWeaponId?`, `armorId?`, `experiences[]?` (name, modifier),
`subclassId?`, `domainCards[]?` (level-1 cards), `levels[]?` (each level taken: advancements,
the card granted, an Experience if any), `bonuses?` (evasion, hitPoints, stress, armorScore,
majorThreshold, severeThreshold). Derived: Evasion and Hit Points from the class, thresholds
from armor plus level, Armor Slots from armor (cap 12), Stress 6 base, the attack's trait, range
and dice from the weapon (unarmed: Proficiency d4, Strength, melee). Unknown ids are reported,
not fatal. Sheets are authored in TypeScript in this build (`src/game/demo-scene.ts`); there is
no sheet editor.

### Level-up option table (as implemented)

Tiers: level 1 is tier 1; 2–4 tier 2; 5–7 tier 3; 8–10 tier 4. A level-up spends exactly 2
picks; the tier's boxes are shared across all levels in that tier, and from tier 3 on a level
may also tick a box the previous tier's sheet left unmarked (shown as "(tier N sheet)").

| Option | Boxes per tier | Cost | Available |
|---|---|---|---|
| +1 to two unmarked traits | 3 | 1 | tiers 2–4; marks cleared at levels 5 and 8 |
| +1 Hit Point slot | 2 | 1 | tiers 2–4 |
| +1 Stress slot | 2 | 1 | tiers 2–4 |
| +1 to two Experiences | 1 | 1 | tiers 2–4 |
| An extra domain card | 1 | 1 | tiers 2–4; the tier 2 box allows cards up to level 4, tier 3 up to 7 |
| +1 Evasion | 1 | 1 | tiers 2–4 |
| Upgrade your subclass | 1 | 1 | tiers 3–4; needs a subclass; foundation → specialization → mastery; crosses out that tier's multiclass box |
| +1 Proficiency | 1 | 2 | tiers 3–4 |
| Multiclass (class + one of its domains) | 1 | 2 | tiers 3–4; once per character; crosses out the mastery card |

Every level also grants one domain card (from the character's domains, level ≤ the new level,
not held). Levels 2, 5 and 8 grant a new Experience (+2) and +1 Proficiency. Maximum level 10.

This table matches the core rulebook's level-up sheet (Chapter 2, "Choosing Advancements").

## 5. The demo campaign

Placeholder fiction. The party is Kara (Guardian, human, chainmail, broadsword), Finn (Rogue,
elf, gambeson, shortbow) and Mira (Wizard, faerie, gambeson, greatstaff), each with a subclass,
two domain cards and one Experience. Every adversary uses the SRD Acid Burrower's stat block,
standing in for the prototype's homebrew Hollow Husks.

1. **The Husk Vault** (imported from the prototype's map, 22×16). The vault door starts shut
   and in the way: using it is a Finesse 13 roll, a failure leaves it shut, and a door can be
   tried again. East of the door, trigger cells start the husk fight; a chest opens
   on a Finesse check and pays out from the `vault-chest` table (gold, a healing draught, or
   the brass key).
2. **The Warden** is the carved pillar. Using it starts the conversation and the quest
   **The Warden's Word**. Ask "Who are you?" to learn the name (this sets a flag; a reply
   gated on that flag exists to demonstrate an `available` condition, but since a used pillar
   refuses a second conversation it is not reachable in normal play). "We came for the vault" → "Then let us ask it politely" costs a Presence 13
   roll: any success gives the party *The Warden's word* (a key item) and ticks step one.
3. **A stair down** behind the husks leads to **The Sounding Pit** (10×8). The banded
   strongbox requires the Warden's word; without it, "The lid will not shift." With it, the box
   pays out from `pit-strongbox`, ticks step two, completes the quest, and grants the party
   level 2 — the Level up buttons appear. The stair up returns to the vault as you left it.

Save between beats; the whole thing is designed to be put down and picked up.

## 6. Limits and known gaps

Taken from `docs/CRPG-GAPS.md` and checked against the code.

- **glTF import is partial.** A project can declare `.glb`/`.gltf` models by URL and content
  can name them, but the Prop palette lists only the built-in library, so an imported model
  is placed by editing JSON. A model is referenced by URL, not packaged with the project; the
  zip packaging CONTEXT.md mentions does not exist. Textures, audio and data-pack import do
  not exist.
- Saves live in `localStorage`, and the log is stored unbounded inside each one.
- **Loading a project JSON does not restart play.** The editor edits the loaded document; the
  running game stays on the project it booted with. A schema failure is not shown in the panel.
- **Checks use the party's best trait**, not the acting character's; using an object in a fight
  spends that character's action. Both are demo decisions, not SRD rules.
- **Quests have no stages**: steps can be hidden and revealed, but the summary is one string
  and is never rewritten.
- **Domain-card and subclass features are text**, shown on the level-up sheet but not
  executed.
- **No items or loot-table UI**, no sheet editor, no tint tool though `tints` is document
  data.
- **Editor camera**: right-drag pan and wheel zoom work in edit mode, but the keyboard camera
  (WASD, Q/E, F, Home) is play-only.
- No entity-hover links in the log.
- Attacks are not read out in the log, and an impossible attack click is silent.
- A scripted check (an object, a conversation) awards Hope to whoever used the thing and Fear
  to the GM, the same as an attack; the check itself rolls with the party's best trait.
- Travel rebuilds the whole scene view; fine for two rooms, not measured for fifty.
- `story` renders as a single log line; its `button` field is ignored.
- Project format is `formatVersion` 1 only; there is no migration. CONTEXT.md mentions zip
  packaging via fflate; only JSON save/load exists in the code read for this manual.

## 7. Licensing

Daggerheart SRD content is used under the Darrington Press Community Gaming License (DPCGL).
Keep this attribution with any distribution:

> This product includes materials from the Daggerheart System Reference Document 2.0,
> © Critical Role, LLC. under the terms of the Darrington Press Community Gaming (DPCGL)
> License. More information can be found at https://www.daggerheart.com. There are no previous
> modifications by others.

The vendored community data sets (`tools/srd-sources/daggersearch/`, `tools/srd-sources/seansbox/`)
are SRD 1.0 and carry their own attribution, which must be kept alongside:

> This product includes materials from the Daggerheart System Reference Document 1.0,
> © Critical Role, LLC. under the terms of the Darrington Press Community Gaming (DPCGL)
> License. More information can be found at https://www.daggerheart.com. There are no previous
> modifications by others.

Daggerheart is a trademark of Critical Role, LLC; this project is unaffiliated. The `seansbox`
README additionally notes its material is Public Game Content under the DPCGL
(www.darringtonpress.com/license).

## 8. Cheat sheet

```
Play                                   Edit
  Left click   select / attack / use / walk   apply tool
  Left drag    orbit                          paint or drag with tool
  Right drag   pan                            pan
  Right click  inspect (Escape closes)        —
  Wheel        zoom                           zoom
  WASD/arrows  pan                            —
  Q / E        turn                           —
  F            frame selected                 —
  Home         frame room                     —
  Tab          next party member              —
  Space/Enter  GM turn                        —
  Ctrl+Z / Ctrl+Shift+Z   —                   undo / redo
  Ctrl+E       toggle play / edit (both modes)

Play panel:  Save (quick slot) · Save as… (named) · Load (list; load or delete)
             Use / Equip beside a pack item · Level up beside a name when a level is owed
```
