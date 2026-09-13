# Tactical Engine — User's Manual

Everything below is taken from the code and docs in this repository as they stand. Where a
detail could not be confirmed from source it is marked **not verified**.

## 1. What Tactical Engine is

Tactical Engine is a browser-based engine and editor for party-based tactical RPGs in the style of
Baldur's Gate 3, running a dual-dice tabletop ruleset: paired resolution dice, Light and
Shadow, Stress, damage thresholds, Armor Slots, classes, subclasses, ancestries, communities,
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

A debug handle, `window.__engine`, is attached to the page for the end-to-end tests. It
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

- **The Duality Dice** (over the map, when a party member rolls): two d12s — gold for Light,
  violet for Shadow — tumbling and settling on the faces that were rolled, with the sum and the
  outcome underneath. They are a view of a roll that has already happened, not the roll itself:
  the rules resolve, and the dice are then told what to land on, so nothing waits for them and
  a seeded replay shows the same faces. Only the party's Duality rolls are shown — an adversary
  rolls a single d20, and the log says what it did. Several at once (a feature everyone has to
  dodge) queue and are shown in the order they were rolled.
- **HUD** (bottom left): one card per party member — name, class, and pips for HP, Stress,
  Armor, and Light (each box one slot, filled when marked), any conditions, and a line naming
  what they wield and wear. The selected card has a blue border; a fallen member is dimmed.
  Clicking a card selects that character. A yellow **Level up** button appears on a card when
  a level is waiting (see Levelling up). The last card shows the GM's **Shadow** pips and either
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

Out of combat there are no turns. Click the ground to walk the selected character anywhere the
floor goes - nobody counts steps; the others follow in a trail. Walking onto a trigger cell
starts that cell's encounter and the mover stops on the trigger rather than running past the
ambush.

These rules are not played on a grid, and neither is this. Distance is as the crow flies: a
creature standing corner-to-corner is in Melee like one standing straight ahead, and the range
bands (Melee, Very Close, Close, Far, Very Far) are circles round whoever is measuring. In a
fight a character moves within Close range as part of an action - the lit disc with a border
round whoever is selected - spent along the way, as BG3 spends movement, so the way round a
pillar costs the way round. A click on the ground is a spot, not a square: the character walks
there in a straight line where nothing is in the way, stops where you clicked (or as near as
their body fits, clear of walls and of everyone else), and the others fall in a pace behind along
the line, round the same corners. Hovering the ground draws the line a click would walk - in a
fight, the part past one move in red. A click beyond reach is not refused: out of a fight it
walks up to the nearest reachable spot (the shut door, the edge of the chasm); in a fight it
walks as far as the move allows and the log says so. A click on an enemy across the room walks
up to where the weapon reaches from and swings, the move being part of the action; with nowhere
in reach this move, it closes as far as it can and the walk is the action. A walk that wakes
an ambush starts the fight when the party gets there, not when the board is crossed: nothing is
lit and nobody acts until the last of them stops. Range is read from
the tile a character is standing in, the way a gridless table reads it to the nearest 5 ft. The
tiles are still there underneath, for the pathfinder and the editor, but nothing in play shows
them.

In a fight there is no initiative. The party acts until an action roll — an attack, a card's
Spellcast Roll — comes up with Shadow or fails, which hands the spotlight to the GM; or until you
press **Pass to GM** (or `Space` / `Enter`). On the GM's turn the GM spotlights one adversary
free and spends a Shadow for each further one while Shadow lasts. A spotlighted adversary moves
within Close range of the nearest party member and attacks; one held in place by Restrained
spends its spotlight tearing free instead. Then the spotlight returns to the party. When the
last adversary falls the log says so and the scene's conditions end.

Attacks and hits are read out in the log ("Kara hits with the Broadsword: 2 Hit Points on
Acid Burrower.", "The Acid Burrower's Claws hits Kara, and is turned aside."). A click on an
adversary that cannot be attacked (out of range, the GM's turn) does nothing visible.

### The action bar

Along the top of the screen sits the selected character's action bar: **Attack** with the weapon in
hand (click an adversary on the board), then one button per ability — the class's Light feature,
subclass cards, and the domain cards in the loadout. Under each name is what it costs ("1 Light",
"2 Stress", "1 left") or, greyed, why it cannot be used now ("needs 3 Light", "the GM's turn",
"nothing in range", "always on" for a passive, "a reaction" for a card that fires on its own,
"the table adjudicates this one" for a card the engine has no script for). Hover a button for
the card's text. Below: **Pass to GM** in a fight, **Rest…** out of one, and **Loadout…**.

An ability that wants a target and has more than one in reach arms the bar — the valid targets
light up on the board; click one, or `Escape` to put the card down. With exactly one target in
reach it fires at once. A card's cost is paid the moment it is played, before any roll it asks
for; a roll it asks for appears in the play panel like an object's. **Step back** from that roll
before any die is thrown and the card goes back in hand with its cost returned; once a roll is
made the turn is spent when the card's script finishes. A choice a card asks for has no step
back in the panel.

### Rests

**Rest…** opens the rest panel out of combat. Short or long; each character picks two of the
SRD's downtime moves — tend to wounds (their own or an ally's), clear Stress, repair armor (own
or an ally's), prepare for Light. A short rest clears 1d4 + tier of the thing; a long rest clears
all of it. Two or more characters preparing together gain 2 Light each. The GM gains 1d4 Shadow on
a short rest and 1d4 plus the party's size on a long one. A rest refreshes "once per rest"
cards (a long rest also "once per long rest" ones), ends conditions that last until a rest, and
is where the loadout changes for free.

### The loadout and the vault

The collection presents domain cards with level, domain and Recall Cost, each wearing a
picture. Search by name or rules text, or filter by domain. Click a card to open its full
readable rules; Escape returns to the collection, and Escape again closes it. The browser
supports keyboard navigation and a two-column layout on phones. The action bar wears the same
picture on each domain card.

**A card's picture** comes from the first of three places that has one:

1. **Art you imported.** Open a card and press **Use your own art…**. The picture is redrawn to
   512 pixels across and kept *in this browser only* — it survives a reload, it is not in your
   save, and it does not travel to anyone else. **Remove** gives the card back whatever it
   showed before.
2. **A file in `public/cards/`.** Drop `bare-bones.jpg` in that directory, run
   `node tools/index-card-art.mjs`, and Bare Bones wears it in the local development app.
   The file name is the card's id: lowercase, no punctuation, spaces as hyphens. The indexer
   prints any file it could not match to a card. Uppercase extensions such as `.JPG` work too.
   Production builds exclude this private directory and use generated emblems or browser imports.
3. **The emblem the card draws for itself**, from its own id and its domain's colour. This one
   always works, so a fresh copy of the project shows complete cards with nothing to install.

An image that cannot load or decode also falls back to the emblem. Importing a replacement
picture immediately retries with the new image.

Five domain cards can be active; the rest wait in the vault. **Loadout…** shows both. Recalling
a card from the vault outside a rest marks Stress equal to its Recall Cost (the button says how
much); when the loadout is full, pick a card to make room first. The loadout rides on the sheet,
so a save carries it.

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

An action roll is two d12: the Light die and the Shadow die, plus the trait modifier, against a
Difficulty. The log reads it out, naming only the parts that applied:

    Light 8 + Shadow 7 + 2 = 17 vs 12. Success, with Light.

Extra parts appear as `+ d6 N` / `− d6 N` (advantage or disadvantage) and `+ help N`. The five
outcomes are critical success (both dice match), success with Light, success with Shadow, failure
with Light, failure with Shadow. A roll with Light gives the roller a Light; a roll with Shadow gives
the GM a Shadow; a critical also clears a Stress. **Step back** declines the roll at no cost: the
outcome lists and `always` are skipped, any effects written after the check still run, and the
object can be tried again.

The prompt offers **Utilize an Experience**: pick one of the acting character's Experiences
to spend a Light and add its modifier to the roll ("Draws on "Held the line" (+2)." in the log).
A roll against a creature ("Roll spellcast against Acid Burrower?") is made once and beats each
target on its own Difficulty.

An object's check rolls with the *best* modifier for that trait in the whole party — a lock is
the party's problem; a card's roll is the acting character's own, with their Spellcast trait
where the card asks for one.

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
asked for it has finished asking you things. Wounds, Stress, Light and the GM's Shadow travel with
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

There are no experience points; a `levelUp` effect placed by the designer grants the
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

Press `Ctrl+E`. The editor is a **top bar** over the board, and a **mode** decides what sits
around the board's edges. In edit mode the view follows the scene being edited, which need not be
the room the party is in; browsing scenes never moves the party or abandons their fight.

### The top bar

| Part | What it does |
|---|---|
| **Project ▾** | Save JSON · Load… · Check (lists what the validator finds; a red badge counts errors) |
| **Content ▾** | Party · Cards · Items & loot · Quests · Code · Models — each opens as a workspace under the bar; its **Close** button or `Esc` closes it |
| **Inspector · Terrain · Combat · Interaction** | The four modes, also on keys `1`–`4` |
| **The scene button** (shows the room's name and size) ▾ | Every scene with its size; **▸** marks the one the project opens on and **●** the one the party is in. Click to edit it; **✎** renames, **▸** makes it the opening scene, **✕** deletes (refused for the opening scene or the last one); **+ New scene** adds a blank 12×10 room |
| **Undo / Redo** | The same history as `Ctrl+Z` / `Ctrl+Shift+Z`; hover for what it would undo |
| **▶ Play here / ▶ Play** | Play in this room from its spawns (Shift-click a tile to play from there), or go back to where the party is |

`Esc` closes the nearest thing: a menu, the problem list, a workspace, a conversation, then the
selection.

### The modes

| Mode | Around the board | What a click or drag does |
|---|---|---|
| **Inspector** (1) | The selected object's properties, on the right | Click an object to select it |
| **Terrain** (2) | Tools on the left rail; **Tiles**, **Ground**, **Props** and **Objects** in the strip along the bottom; the tool's options on the right | Build stacked tiles anywhere; erase tiles at a chosen level; paint ground (brush 1×1, 3×3, 5×5); raise/lower ground; place props and objects |
| **Combat** (3) | Tools on the left rail; the SRD's creatures by tier in the strip, with a search; the encounter on the right | Place the picked creature in the encounter; toggle trigger cells that start it; toggle party start tiles; erase a creature, then a trigger cell, then a party start (never the last one) |
| **Interaction** (4) | The conversations, on the left | Click one to open its graph |

Opening a Terrain library tab chooses the placement action automatically: Tiles builds,
Ground paints, Props places props and Objects places objects. Picks are remembered when switching
tabs. The rail only offers the applicable erase or raise/lower actions; there is no separate
placement-type selector. Clicking the tab or an item returns from erase to placement.

### Building tiles beyond the board

Open **Terrain → Tiles** and choose Block, Floor, Wall or Stairs. Pick stone, wood or grass
on the right, then click or drag on the purple build grid. The translucent piece previews
the placement. Brushes cover 1×1, 3×3 or 5×5 cells; a drag is one undo step.
Each stamp creates an independent piece, even where other pieces already exist. A drag visits
each cell only once; a fresh click or stroke can place another identical piece there.

Use the vertical **Z ladder at the board's right edge**, beside the mode panel, for placement
height in tile units. It draws one rung per quarter tile around the level being placed at, and
rungs near that level are large while further ones shrink away — so the level being aimed for is
also the easiest to hit. **Drag the ladder** to scrub: it moves with the pointer, past a selector
that stays put, so pulling down brings the levels above down to meet it and raises the height. The
first quarter tile costs a whole rung and later ones cost less, so a small movement is precise and
a long one travels. Whole tiles are **detents** — the drag falls into them and needs a deliberate
pull to leave — so a round number is the easiest level to stop on, and they are drawn as the
ladder's landmarks: taller, wider and always numbered. **Click a rung**
to jump straight to it, or roll the wheel over the ladder for a quarter tile a notch. The +/−
buttons move a quarter tile, as do the arrow keys once the ladder itself has focus — unfocused,
the arrows still pan the camera. Page Up/Down moves a whole tile, and the box underneath takes
exact heights out to ±1,000,000 — past anything the ladder draws. The separate
**Piece height** field scales a piece vertically, from 0.25 to 16; floors start
at a quarter-tile thickness. **Hold Alt and drag toward a tile edge** to point tiles or props
in that cardinal direction. The camera angle is accounted for, so dragging along the visible
grid chooses the matching north, west, south or east edge. While Alt is held, the tile preview stays in place and
mouse gestures do not stamp pieces or pan the camera. Release Alt, then click to place with
the chosen facing. **R** and **Rotate** also turn tiles and props; the four **Wall edge** buttons
put walls along the north, west, south or east edge, meeting at the corners.
Four walls and a floor can occupy the same tile. **Erase building
tiles** removes the most recently placed piece at the selected X/Y/Z; repeat to peel away
overlaps. Undo/redo and JSON save/load preserve every instance.

Raise and Lower still move the ground a whole level at a time, and Z does not touch it: a piece's
Z and the ground's height are two different units until multilevel navigation unifies them.

Props, objects and creatures can also be authored beyond the board. Creature placements appear
immediately in the editor, including at the height shown by the same right-side **Z ladder**. Generic creature bodies stand
in for SRD creatures without a dedicated model — 128 of the 129 stat blocks — and the engine still
counts those definitions as unresolved, because they are. Undo and scene switching update what is
drawn.

To change what a creature looks like, take **Select** from Combat's rail and click one on the board.
The panel on the right then shows that creature, with two model fields. **Model · every _type_**
re-skins the whole type: set it on one Acid Burrower and every Acid Burrower in the project is drawn
that way, which is the usual want. **Model · this one only** overrides that single creature, for a
named lieutenant or a standout; setting it back to *Whatever the type uses* clears the override and
leaves the type alone. Both lists offer the built-in models and anything the project imported under
**Models**, so an imported `.glb` is chosen by name rather than by naming the file after an adversary.
The same panel edits that creature's **Name** and **Hit points**, which are per-creature overrides of
its stat block. **Check** warns about a model name nothing can supply — the creature still plays, it
just stands in a borrowed body.
Every entry into a room brings its creatures up to date with the document: returning to play,
travelling in through a door, or loading a save each add the creatures placed since and remove
the ones deleted since, keeping existing wounds, party pools and anything a script has already
taken off the board. A creature placed outside the board is drawn in the editor and reported by
**Check**, but it does not enter play: outlying and elevated authoring still needs multilevel
navigation before it can be fought on.

Right-drag or WASD/arrows pan; Q/E orbit; the wheel zooms. **Go to coordinates** jumps to a
distant build, including negative coordinates. **Home** returns to the original map.
X, Y and build level each support −1,000,000 through +1,000,000. Empty space allocates nothing;
memory and saved file size grow with the number of placed pieces, not the distance between them.

Nearby pieces have beveled edges, middle-distance pieces use simpler geometry, and far stairs
become solid silhouettes. Chunks outside the viewing range unload automatically. On a dense
view, the nearest 96 visible chunks take priority and load progressively.

**Building tiles are scenery in both edit and play.** They do not yet add walkable surfaces,
collision or line-of-sight blockers. Party navigation still uses the original rectangular
ground map; elevated and outlying builds need multilevel navigation before they can be played.

### Objects and the inspector

In Inspector mode, click an object. The inspector edits:

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
party up — and the combat vocabulary a card is written in: Make an attack, Mark/Clear Stress,
Mark/Clear Armor Slots, Gain/Spend Light, GM gains Shadow, Apply/Clear a condition, Put tokens on a
card, Spend tokens on a card, Push them back, Ask for a reaction roll, and Run code. Scene,
conversation, encounter and quest ids are dropdowns over what the project holds; the objective
dropdown follows its quest. Flag, key and loot-table ids are typed.

**Who an effect lands on** is the same little control everywhere: a dropdown of the chosen
target, everyone the roll beat, the one acting, the whole party, allies in range, adversaries in
range, one named creature, or named creatures — leaving it on *— default —* keeps the effect's
own default rather than writing a selector. Adversaries add a range band, whether it is measured
from the actor or the target, and an **all *other*** box, which is the SRD's "all other targets
within range". **Deal damage** switches between a flat amount and rolled dice; the dice field
takes an expression, or the words `weapon` (the actor's own) and `same` (the damage this script
already rolled), with ×Proficiency, ×Spellcast, *half* and *direct* beside it. **Make an attack**
and **Ask for a reaction roll** nest effect lists of their own, for a hit and a miss, or for
those who fail and those who pass. **Run code** picks a hook — the engine's own or the project's
— and takes `name=value` arguments handed to it as `ctx.args`.

**If … then** adds a `branch`: a condition editor for its `when` (kind from a dropdown; quest,
objective and encounter ids from dropdowns; flags, items and variables typed; `not`/`all`/`any`
nest), then two effect lists for *then* and *otherwise*. **Reveal an objective** brings a hidden
quest step into the journal.

**Ask for a roll** adds a `check` with the same editor an object's roll uses — trait,
difficulty, prompt, and an effect list per outcome. Inside a card's script it also shows who the
roll is **against** (the same selector) and a **reuse the last roll** box: no new dice, the last
roll made in this script standing against each target's Difficulty, which is how Whirlwind hits
the rest of the room off one swing. **Ask the player** adds a `choice`: a title,
what the player is told, and options, each with a label, an optional *if…* gate and its own
effect list. **Story panel**, **Set/Add a variable**, **Give/Take an item** and **End a fight**
are edited inline. Every effect kind the engine runs can now be built in the editor.

### Conversations (the graph)

**Conversations** lists each dialogue with its node count; **+ Conversation** asks for an id
and creates a one-node dialogue; **✕** deletes one. Clicking a conversation opens the graph
over the whole view:

- Node cards on a pannable surface (drag the background to pan, drag a card to move it; a
  position is only written to the document when a node is dragged). The start node has a
  yellow border and ▸. **+ Node** adds one near the view; **Close** returns to Interaction
  mode's conversation list.
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

A **Models** section lists the project's imported models. **+ Model** opens a file picker for a
`.glb`/`.gltf`; the file is read **into the project**, so one saved document carries its art with
it and opens anywhere. The id comes from the file name, made unique if it is already taken, and the
row reports the file by weight (`embedded · 2.4 MB`) rather than printing megabytes of encoded data.
**✕** removes one. A model already sitting beside the app is still referenced by its path, and the
row shows that path instead.

Each model carries three settings: **Scale** (a tile is one unit — most sample files are in metres,
so 0.01 is a common answer), **Ground offset** to sit its feet on the tile, and **Rotation °** to
turn it to face the way the built-in models do.

A rigged file's animations are chosen by name, from four dropdowns listing **the clips the file
actually contains** — they fill in once it has loaded:

| Clip | Plays |
|---|---|
| **idle** | at rest, on rising, and on arriving somewhere. Left blank, the first clip in the file loops. |
| **walk** | while moving to a tile. Blank keeps whatever is playing, so it idles along. |
| **hit** | on taking a blow, for about a third of a second. |
| **fallen** | on going down. Blank leaves it lying on its rotation alone. |

Content names an imported model by id exactly as it names a built-in one — a deco's or an object's
`model` field, a creature's model in Combat's panel, or an entity's definition — and the built-in
placeholder stands in until the file has loaded. **Check** warns about a model nothing can supply,
and about an embedded file heavy enough (past 8 MB) to be felt on every save and load.

### Playing what you authored

**Save** writes the project as JSON; **Load** reads one back and restarts the game on it. That
is the round trip: write a party, a room, the things in it and the fight past them, save, load,
play. `buildProjectScene(project, seed)` is the engine's side of it — hand it a document and it
stands a game up — and `editor/authored-scenario.test.ts` walks the whole path with nothing but
session edits, no engine code anywhere in it.

### Party

**Write a character…** opens the Party panel: the campaign's own characters, one at a time. A
sheet is a name, a class and subclass, an ancestry and a community, six traits, the armor and
weapons they carry, the domain cards they know and which five are in the loadout, and their
Experiences. Nothing mechanical is typed: Evasion, Armor Score, Hit Points, Stress, damage
thresholds and Proficiency are all derived from what the sheet *names*, and the line under the
form shows them as they change. Ids are picked from the vendored SRD content, and the lists
narrow the way the rules do — subclasses to the class, cards to the character's domains and
level. An id that does not resolve is shown in red under the form and reported by **Check**.

Levels are shown but not edited: a level is taken at the table, where the level-up form records
what was ticked, and this panel is the record rather than a second way to write it. Changing the
class clears the subclass and the cards with it — a new class is a different character, and the
cards were from domains they no longer have. Undo puts all of it back.

Whatever changes a sheet — a level taken, a card recalled, a save restored — writes it back to
the project, so the document and the table never hold two different characters.

**A sheet edited here reaches the table when you press Play** — the party's numbers are rebuilt
and their pools refitted. Adding or removing a character changes the document but not a game
already running: somebody standing in a fight is not something an edit should pull out from
under it, so a new character joins when the project is next loaded.

### Cards

**Write a card…** opens the Cards panel: the project's own cards, one at a time, beside a count
of the ones the engine ships (those live in `srd/abilities.ts` and are edited in code). A card
is its name, the text as printed, the character ids that hold it, whether it is an action, a
reaction (and what it answers) or passive, what it costs in Light, Stress and Shadow, who it can be
aimed at and how far, whether using it is the character's action, whether it is only for a fight,
whether it holds tokens and when they refill, what it resists, what it takes off the damage,
whether the swing its stat block prints goes through armour — and then the effect list, which
is the same one every other panel uses, including an attack's own reach and whether it goes
through armor, and a reaction roll's damage, which is rolled once before anyone rolls to avoid
it. A card with no effects is not broken: it is shown as text and the table
decides, exactly as an unscripted SRD card is.

### Items and loot

**Write an item…** opens the Items panel, which holds both halves of the pack because they only
mean anything together. An **item** is a name, a description, a kind (key, consumable, weapon,
armor, trinket), whether a second one stacks, and an effect list for what using it does — the
same list every other panel edits, so a draught heals and a scroll starts a conversation. A
consumable is spent by the use; anything else stays in the pack. A weapon or armour also picks
the SRD content it stands for, from the same vendored list the Party panel uses, so equipping is
a lookup rather than a copy and an id that does not resolve is caught by **Check** rather than at
the moment somebody tries to equip it.

A **loot table** is how many times a chest draws and what it draws from: an item, how many
(a fixed count or a range rolled per drop), and a weight. Weights are relative to the rest of
the table rather than percentages, so the panel shows the odds each entry works out to instead
of asking for numbers that add to a hundred.

Deleting an item does not quietly rewrite the tables and doors that named it. The reference
stays and **Check** reports it — a loot entry, a `giveKey`, or a door's `requiresKey` naming
nothing is an error — because a designer needs to see what they broke.

### Code

**Write logic in code…** opens the Code panel: the project's own hooks, one at a time. It
compiles as you type — the line under the editor says `Compiles.` or the error — and names the
cards that run each piece, so deleting one is not a guess. What a hook may read, write and roll
is on the panel itself, and in full under **Logic in code**.

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
"unsaved" mark. **Load** opens a file picker; the file is parsed through the project schema, and
if it is playable, replaces the document the *editor* holds, redraws the view, and restarts the
game on it — the same round trip described under **Playing what you authored** above. A file
that fails the schema is recorded in `__engine.errors`, and nothing is shown under Project ▾.

### Undo

Every editor change goes through one command history: brush strokes coalesce per drag, typing
coalesces per field, graph drags are one step each. `Ctrl+Z` / `Ctrl+Shift+Z` or the buttons;
the buttons' tooltips name the step.

## 4. Content reference

### Project document

`formatVersion` (1) · `id` · `name` · `terrainPalette?` (id, name, passable, cost,
providesCover, blocksSight) · `scenes[]` · `dialogues[]` · `items[]` · `lootTables[]` ·
`quests[]` · `abilities[]` · `conditionDefs[]` · `code[]` · `party[]` · `startScene`. All ids
are stable kebab-case strings; duplicates are rejected.

A **character sheet** (`project.party[]`): `id`, `name`, `level`, `classId`, `subclassId?`,
`ancestryId?`, `communityId?`, `traits` (the six), `proficiency`, `armorId?`,
`primaryWeaponId?`, `secondaryWeaponId?`, `experiences?` (`name`, `modifier`), `domainCards?`,
`loadout?` (at most five), `levels?` (what was ticked at each level taken) and `bonuses?` (flat
adjustments to Evasion, pools and thresholds). Everything else — Evasion, Armor Score, Hit
Points, Stress, thresholds, the trait an attack rolls — is derived from those. `party` is
defaulted, so a project written before it existed still parses.
`assets[]` holds imported models (`id`, `kind` 'gltf', `url`, `scale`, `groundOffset`,
`rotationY`).

A **scene**: `id`, `name`, `intro` (logged on arrival), `width`, `height` (≤ 512), `terrain[]`
(terrain ids, row-major), `heights[]`, `tints[]?` (per-tile CSS colour, presentation only),
`spawns[]` (≥ 1), `interactables[]`, `encounters[]`, `decos[]`, `fogBand?`, `buildingTiles?`.
`buildingTiles` is a sparse record keyed by `x,y,level` with optional `#instance` suffixes for
overlapping pieces. X/Y are integers; `level` stores vertical Z in quarter-tile increments, and
optional `height` scales the piece vertically. Each piece has a `shape` (block/floor/wall/stairs),
`material` (stone/wood/grass) and `rotation` (0–3 quarter turns). Old unsuffixed keys still load.
`heights[]` is whole levels, as it always was, and is a different unit from a piece's `level`.
Props, objects and adversaries accept signed placement coordinates and optional `position.z`.

An **interactable**: `id`, `kind` (chest | door | pillar | portal | scripted), `position`,
`name`, `flavor`, `model` (null = invisible), `blocksMovement`, `effects[]`, `check?`,
`requiresKey?`, `lockedText`, `goto?`, `tags[]`, `data{}`.

An **encounter**: `id`, `name`, `adversaries[]` (`id`, `adversary` = SRD adversary id,
`position`, `name?`, `hitPoints?`), `triggerCells[]`, `startsOnTrigger`. A **deco**: `model`,
`position`, `rotation` (radians), `id?`.

Log tones: `narration` (default text), `system`, `good`, `bad`, `combat`, `success`.
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
| `pool` | `pool` (hitPoints \| stress \| armorSlots \| good), `of?`, `measure?` (available \| marked \| max), `op`, `value` | a creature's pool compares so; `of` defaults to the actor |
| `inCombat` | — | a fight is on |
| `loadout` | `domain`, `of?`, `op`, `value` | how many of that domain's cards are in the loadout, for whoever `of` names (the actor by default) — what the "-Touched" cards read |
| `hasCondition` | `condition`, `of?` | any of `of` (default: the chosen target) bears the condition |
| `withinRange` | `range`, `of?` | any of `of` (default: the chosen target) stands within that band of the actor |
| `tokens` | `ability`, `of?`, `op`, `value` | tokens on that card, for whoever `of` names (the actor by default), compare so |
| `hook` | `hook`, `args?` | logic in code says so — the hook returns `true` (see **Logic in code**) |

**Target selectors** (`target`/`of` fields): `actor`, `party`, `entity` (`id`), `entities`
(`ids[]`, in the order given — what a hook builds when it picks them itself), `target` (what
the player picked when using an ability), `hit` (whoever the last roll beat; `having?` keeps
only those with a condition), `allies` (`range?`, `includeSelf?`), `adversaries` (`range`,
`around?` actor \| target — the SRD's group, measured from the chosen target; `except?: target`
leaves the chosen target out — "all other targets within range").

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
| `damage` | `amount` **or** `dice` ("d8+2"; `weapon` for the actor's own weapon; `same` to reuse the damage already rolled in this script), `type?`, `using?` (proficiency \| spellcast), `direct?`, `half?`, `target?`, `source?` | `amount` marks that many Hit Points outright (default target: the actor). `dice` rolls damage once and takes it through thresholds, resistances, Armor Slots and reactions on each target (default: `hit`), scaled by Proficiency or the Spellcast trait, with a critical's maximum dice. `same` rolls nothing: it hands on the last damage this script rolled — the total off an `attack` or an earlier `damage` — which is how Whirlwind gives the rest of the room half of the swing it already made rather than a second roll |
| `heal` | `amount` **or** `dice` ("1d4"), `target?` | clears Hit Points; brings a fallen character back up. `dice` is rolled once and the same number clears for every target |
| `markStress` / `clearStress` | `amount?` (1), `target?` (actor) | a full Stress track marks a Hit Point instead |
| `clearArmor` | `amount?`, `target?` | clears Armor Slots |
| `gainGood` | `amount?`, `target?` | Light to the target(s); an adversary gains none |
| `spendGood` | `amount?` | the actor spends Light; refused (and logged) without enough |
| `loseGood` | `amount?` (1), `target?` (hit) | Light taken rather than spent — "all targets within Far range lose a Light". Never refused: a creature with one loses one, a creature with none loses nothing. "If they can't lose a Light, they mark 2 Stress instead" is a branch on how much was taken, which is the GM's to read |
| `applyCondition` / `clearCondition` | `condition`, `duration?` (temporary \| scene \| rest \| permanent), `target?` (the chosen target) | a condition cannot stack; `temporary` is what an adversary shakes off, `scene` ends with the fight, `rest` at a rest |
| `attack` | `weapon?` (primary), `target?`, `advantage?`, `damageBonus?`, `damage?` (dice instead of the attacker's own), `range?` (reach instead of the attacker's own — a stat block prints one reach for its claws and its features say their own), `direct?` (damage no Armor Slot reduces), `onHit[]?`, `onMiss[]?` | a weapon attack as an action roll: Light or Shadow, the spotlight, a critical's extra dice. A selector naming several creatures is swung at in turn, each with its own roll, and `onHit` runs once with everyone it beat bound to `hit`. An adversary swings what its stat block prints |
| `markArmor` | `amount?`, `target?` | marks Armor Slots with no benefit — the SRD's "must mark an Armor Slot without receiving its benefits" |
| `gainBad` | `amount?` | the GM gains Shadow |
| `addToken` / `spendToken` | `ability`, `amount?`, `target?` | puts tokens on a card the actor holds, or takes them off. `addToken` with no amount places the card's own count; spending more than are there is refused and logged |
| `summon` | `adversary` (a stat block id), `count?` (dice, one when left out), `perPc?`, `range?` (the band they appear in, Close by default), `spotlight?` | Puts creatures on the map around whoever is acting, in the band named — a ring, not a disc, falling inward when there is no room in it. They are in the fight the moment they stand there, because the encounter reads the map rather than a roster. `spotlight` makes them act at once instead of next turn; `perPc` multiplies the count by the party still standing |
| `push` | `to` (band), `target?` | knocks the target(s) straight away from the actor until the distance reads as that band, stopping at a wall or a creature |
| `reactionRoll` | `difficulty` (number \| `roll` = the actor's last total), `trait?`, `targets?` (hit), `damage?` (`dice`, `type?`), `onFail[]?`, `onSuccess[]?` | adversaries roll a d20, party members their Duality Dice (no Light or Shadow); `onFail` runs with the failures bound to `hit`, then `onSuccess` with the rest. `damage` is rolled once, before anyone rolls to avoid it, and both branches spend it with `{ kind: 'damage', dice: 'same' }` — the successes adding `half`. That is what "targets who succeed take half damage" means: half of the number that landed, and something to halve even when nobody failed |
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

`trait` (a trait, or `spellcast` for the actor's Spellcast trait, or `weapon` for the trait of
the weapon in hand), `difficulty` (a number, or `target` for each target's own Difficulty —
an adversary's, or a party member's Evasion), `targets?` (a selector; the chosen target when
left out), `roll?: last` (reuse the last action roll made in this script — Whirlwind's "the
same attack roll against all other targets" — no dice, no prompt, no Light, Shadow or spotlight;
the total stands against each target's Difficulty), `tags?`, `prompt?`, and effect lists `onCriticalSuccess`, `onSuccessWithGood`,
`onSuccessWithBad`, `onFailureWithGood`, `onFailureWithBad`, `always` (runs after the outcome
list). One roll is made; against targets it succeeds against each one it meets or exceeds, and
those are bound to the `hit` selector for the outcome lists. A Spellcast Roll by a character
whose subclass has no Spellcast trait is refused before any die. Fallbacks when a list is missing: critical → success with Light → success with Shadow; each
success falls back to the other success; each failure to the other failure. Writing one success
and one failure list therefore covers all five.

### Logic in code

Everything above is data: serialisable, editable in the panel, safe to replay. Some things a
designer wants are not — "spend any number of Light and roll that many d6", "one option per
adversary in reach", a house rule the vocabulary never anticipated. Those are **hooks**, and
they are reached from the same vocabulary: the effect `{ kind: 'run', hook: 'id', args? }` and
the condition `{ kind: 'hook', hook: 'id', args? }`.

There are two doors and one lookup:

- **Native hooks** — TypeScript registered with the engine (`defineHooks` in
  `engine/script/hooks.ts`). The engine's own are in `engine/content/srd/hooks.ts`:
  `arcane-barrage` and `wild-flame`, the two SRD cards whose mechanic is a count.
- **Project code** — JavaScript the project carries in `code[]` (`id`, `name`, `notes`,
  `source`) and the editor's **Code** panel writes. Compiled with `new Function` when the
  project loads and again whenever the text changes.

A project entry with the same id as a native hook wins, so a campaign can rewrite one of the
engine's without touching the engine.

**What a hook may do.** It is handed one argument, `ctx`:

| | |
|---|---|
| reads | `ctx.actor`, `ctx.targets`, `ctx.hit`, `ctx.args`, `ctx.inCombat`, `ctx.lastRoll`, `ctx.pool(id, pool, measure?)`, `ctx.hasCondition(id, name)`, `ctx.bandTo(a, b)`, `ctx.difficultyOf(id)`, `ctx.select(selector)`, `ctx.flag(name)`, `ctx.variable(name)`, `ctx.countAlive(faction)`, `ctx.tokens(id, ability)` |
| writes | `ctx.queue([effects])` and `ctx.log(text, tone?)` — and nothing else |
| dice | `ctx.rng` (`die(n)`, `dice(count, sides)`, `pick`, `shuffle`) |

Two rules make that list what it is. **A hook cannot write directly**: it queues effects, which
the runner then runs, so everything it does is journalled, shown in the log, and goes through
the same rules as an authored effect — a hook can never quietly move a Hit Point. **A hook
cannot roll its own dice**: `Math.random` throws, because a hook that rolled off it would break
every seeded replay silently. The queued effects run where the `run` sits, before whatever
follows it.

A `hook` condition gets the reads and nothing else — no `queue`, no `rng` — and is true only
when the code returns exactly `true`.

**What it cannot reach.** `document`, `window`, `globalThis`, `fetch`, `Date`, `setTimeout`,
`console`, `localStorage` and friends are shadowed as `undefined`. That is a guard rail against
honest mistakes (a `Date.now()` that would desync a replay), **not a security boundary**:
project code is trusted exactly as the rest of a project file is. Do not load a campaign you
would not run.

**Errors.** A body that will not compile is a validator error naming the id and the message,
shown live in the Code panel; a hook that throws at the table is a refusal in the log
(`hook "x" failed: …`), and play carries on. A `run` naming a hook nothing defines is a
validator error and a refusal.

The demo ships one: `rally-the-line`, a card written in the project's own code, granted to
Kara. Open the editor, press **Write logic in code…**, and it is there to read and change.

```js
// Each ally in Close range clears what they most need cleared.
var allies = ctx.select({ kind: 'allies', range: 'close', includeSelf: true });
var effects = [];
for (var i = 0; i < allies.length; i++) {
  var id = allies[i];
  var marked = ctx.pool(id, 'hitPoints', 'marked') || 0;
  var max = ctx.pool(id, 'hitPoints', 'max') || 1;
  var who = { kind: 'entity', id: id };
  effects.push(marked * 2 > max
    ? { kind: 'heal', amount: 1, target: who }
    : { kind: 'clearStress', amount: 1, target: who });
}
ctx.queue(effects);
```

### Abilities and conditions

An **ability** (`project.abilities[]`): `id`, `name`, `source` (`domainCard` `card` \| `classGood`
`classId` \| `classFeature` `classId` \| `subclass` `subclassId` + `stage` \| `granted`
`characters[]` \| `adversary` `adversaries[]`), `text` (the card's SRD text when empty), `kind`
(action \| reaction \| passive),
`trigger?` (incomingDamage \| attackHit \| attackMissed \| tookSevere — things that happen to the
holder — plus `dealtHit` and `dealtDamage`, which answer the holder's *own* standard attack:
`dealtHit` whenever it lands, `dealtDamage` only when a Hit Point was marked. Both are read on
the GM's swing alone, so a card that carried one would be read by nothing), `cost` (`good?`, `stress?`,
`bad?` — the GM's pool, so it belongs to a stat block's features; a character ability that states
one is refused at the table and warned about by **Check**), `uses?`
(`count`, `per` rest \| longRest \| scene), `target` (`kind` none \| self \| adversary \| ally \|
creature \| group, `range`), `available?` (a condition read with the card's *holder* standing
as the actor, so "when you have 2 or fewer Hit Points unmarked" is about them and not about
whoever is swinging; a `modifier`'s `when` is read the same way), `inCombatOnly`,
`action` (whether using it is the turn), `effects[]`, `modifiers[]` (`stat`, `bonus`,
`plusTrait?`, `requires?` unarmored \| armored \| meleeWeapon, `when?` — a stat block's passives
are read the same way, and unlike a character's they are not baked into the block's numbers
first), `standardAttack?` (for a `passive`: `direct` — the swing the block prints goes through armour),
`joinedBy?` on an `attack` effect (a target selector: everyone it names walks into reach and
swings with the attacker, one roll, the damage counted once for each of them — a Minion swarm),
`defenses?` (for a `passive`: `reduce[]`, a number taken off the damage before the thresholds
are read — `{ dice: '3' }` or `{ dice: '1d10' }`, with an optional `only` naming a damage type —
and `resistances[]` / `immunities[]` of physical \| magic —
halving rounds up, and damage of two types is only halved by a creature that resists both, which
is what the Spellblade's Arcane Steel exists to defeat), `reaction?` (for a
reaction to damage: `reduceSeverity` `steps` `only?`, `reduceDamage` `dice`, `extraArmor` `slots`
`only?`, `redirect`, `reroll` `what`), `tokens?` (`amount` — a number, a trait or `spellcast` —
`minimum`, `refill` session \| longRest \| rest \| scene \| never — a `session` card refills on a
long rest, which is where a session boundary falls in play), `auto` (whether a reaction
fires on its own; an interrupt never does). `src/engine/content/srd/abilities.ts` is the library
for the SRD's cards and `docs/CARDS.md` lists what is scripted;
`src/engine/content/srd/adversary-abilities.ts` is the same for stat-block features, listed in
`docs/ADVERSARIES.md`. Those come with the block: a project that places an Acid Burrower gets
Spit Acid without writing it, and a project ability with the same id says something different
with it.

A stat block holds reactions the same way a character does: `reactionsFor` reads what the
creature holds on either side of the table, so an adversary's `reaction` to incoming damage
would be paid for and used exactly as a card's is. None ship yet — the shipped ones answer the
block's own attack.

**Adversary features.** The role features every third stat block shares are read straight off
the block (`src/engine/combat/adversary-features.ts`): **Relentless (X)** spotlights it up to X
times a GM turn, each past the first costing a Shadow; **Horde (X)** switches its standard attack's
damage once half its Hit Points are marked; **Minion (X)** falls to any damage and takes one more
of its kind down per X damage; **Momentum** hands the GM a Shadow on a successful attack;
**Terrifying** does that and costs every PC in Close range a Light. Action and reaction features
are abilities sourced to the adversary. The GM plays one a turn and pays what the block says it costs — a Shadow for one that names no
cost at all, so that a free feature is not simply what the adversary does every turn. Which one:
a feature that goes off around the adversary is used when it would catch two or more of the
party; one that names a creature ("make an attack against a target within Close range") only
needs someone in reach, and is aimed at the nearest, by id on a tie, exactly as a claw is. A feature aimed at
nobody but itself — a heal, a shout — catches no one by definition, and whether it is worth a
turn is what its `available` says ("if the Hydra has any marked HP"): area first, then aimed,
then itself, and the block's own order inside each. `uses` is counted under the creature's own
id, so "once per scene" is once for that adversary and back for the next fight. From an adversary's script,
`allies` is the party and `adversaries` the adversaries, whoever is acting: the selectors name
factions, not sides. From a stat block, `allies` is who the feature is aimed at, and a feature
that helps its own kind reaches for `adversaries`.

A character's abilities are the class's, the subclass's up to the stage reached, and the domain
cards in the loadout (`sheet.loadout`, at most five; the first five held when unset).

A **condition definition** (`project.conditionDefs[]`): `id`, `name`, `text`, `modifiers[]` (the
same shape), `defenses?` (the same shape as a passive's: what carrying it does to damage coming
in), `blocks[]` (act \| move \| reactions — an adversary that cannot act spends its
spotlight shaking the condition off, or the GM spends a Shadow to clear one that only ends on
damage; one that cannot move tears free instead of closing in; `reactions` silences its damage
reactions), `endsWhen?` (hit \| attacks \| damaged). `vulnerable` and `hidden` are read by the attack rules
directly; Tava's Armor and Rogue's Dodge are modifiers on a condition.

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
- **Loading a project JSON restarts the game on it.** The party, the rooms and everything in
  them come from the loaded document, so what a designer saves is what they play. It refuses
  three ways, each with the reason in the panel: mid-fight or mid-conversation (there is a turn
  order or a prompt waiting on the game that is running), a document that does not parse, and a
  document that parses but cannot be stood up — a start scene that is not there, or a room
  placing an adversary with no stat block. Nothing about the running game changes when it
  refuses. A save from one project does not load into another.
- **An object's check uses the party's best trait**, not the acting character's; using an
  object in a fight spends that character's action. Both are demo decisions, not SRD rules.
  A card's roll is the acting character's own.
- **The defender is asked how a hit lands** when an adversary's *standard attack* connects: take it, mark
  an Armor Slot, spend a card that can pay (Get Back Up, Iron Will, a Rune Ward), or let an ally
  interrupt — I Am Your Shield takes the hit instead, Not This Time makes the adversary reroll
  the attack or the damage. Each option says what it costs and what it would leave. The GM's
  turn stops on the question and picks up when it is answered; stepping back takes the hit as
  it comes. Damage from a script (a card, a trap) is still resolved automatically, and so is
  everything in a headless run, where there is nobody to ask.
- **53 of the 189 domain cards are scripted** (`docs/CARDS.md`, which lists every one and what
  each scripted card leaves to the table). The rest are shown as text, and the same holds for
  the stat-block features the engine does not run (`docs/ADVERSARIES.md`, which groups the
  reasons) — an adversary plays the ones the engine knows and otherwise falls back on its
  standard attack. A card is text when it asks for
  something the engine has no number for: a Countdown, flight, teleportation, a summon, being
  unseen, or a GM's discretion.
- **A temporary condition on a party member ends when their turn does** — "until they next
  act", read as the moment the party hands the spotlight back. It is how a hold the SRD ends
  with a Strength Roll comes off at all, since nothing here can ask for that roll.
- **Adversaries clear a temporary condition only when Restrained** (or with nothing in reach).
  The SRD lets a creature roll or spend to clear one; here an adversary spends its spotlight,
  and a party member's ends when their turn does.
- **Quests have no stages**: steps can be hidden and revealed, but the summary is one string
  and is never rewritten.
- **Domain-card and subclass features without a script are text**, shown on the action bar and
  the level-up sheet but not executed; see `docs/CARDS.md`.
- **No items or loot-table UI**, no sheet editor, no tint tool though `tints` is document
  data.
- **Construction navigation**: building tiles have visual LOD but do not yet affect walking,
  collision or line of sight. The tactical ground remains a single height field.
- **Editor camera**: right-drag pan, wheel zoom, WASD/arrows, Q/E and Home work in edit mode;
  **F** (frame the selected character) is still play-only.
- No entity-hover links in the log.
- An impossible attack click is silent.
- A scripted check (an object, a conversation) awards Light to whoever used the thing and Shadow
  to the GM, the same as an attack; an object's check rolls with the party's best trait.
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

The community data sets the engine's content was built from were SRD 1.0 and carry their own
attribution, which must be kept alongside:

> This product includes materials from the Daggerheart System Reference Document 1.0,
> © Critical Role, LLC. under the terms of the Darrington Press Community Gaming (DPCGL)
> License. More information can be found at https://www.daggerheart.com. There are no previous
> modifications by others.

Daggerheart is a trademark of Critical Role, LLC; this project is unaffiliated.
One of those sets noted its material as Public Game Content under the DPCGL (www.darringtonpress.com/license).

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
  Space/Enter  pass the spotlight to the GM   —
  Escape       close card / put an armed card down
  Ctrl+Z / Ctrl+Shift+Z   —                   undo / redo
  Ctrl+E       toggle play / edit (both modes)

Play panel:  Save (quick slot) · Save as… (named) · Load (list; load or delete)
             Use / Equip beside a pack item · Level up beside a name when a level is owed
Action bar:  Attack · one button per ability (cost or reason underneath) · Pass to GM
             Rest… (out of combat) · Loadout… (recall costs Stress outside a rest)
Roll prompt: Utilize an Experience (1 Light) · Roll · Step back
```
