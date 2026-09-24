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
| Left click | Party member: select, and the camera slides over them. Adversary: attack with the selected character. Object: use it, walking up to it first when it is out of reach - anywhere on it that its white outline lights, not only over the middle of its tile. Ground: walk there - the spot answers with a ripple in the selected character's blue, or a small red shake when the click walks nobody. | Apply the current tool to the tile |
| Left drag | Walk the selected character towards the pointer in play; orbit the camera in the editor. Turning the view in play is the **middle** drag | Drag with the current tool — erase, raise and lower follow the pointer; the placer puts one piece where it is clicked |
| Middle drag | Orbit the camera | Orbit the camera |
| Right drag | Pan the camera | Pan the camera |
| Right click (still) | Inspect what is under the pointer: a card with a character's pools, Evasion and gear, an adversary's tier, role, Difficulty and the cards its stat block prints, or an object's kind, state and the roll it asks for. On the way to use something or talk to somebody, it calls that off instead: whoever is walking stops where they have got to, and nothing is used or said | — |
| `Escape` | Close the inspect card | — |
| Mouse wheel | Zoom | Zoom; with `Ctrl` held and a placing tool in hand, a quarter tile of build level a notch |
| `W A S D` / arrow keys | Pan (held; smooth) | — |
| `Q` / `E` | Turn the camera | — |
| `F` | Frame the selected character | — |
| `Home` | Frame the whole room | — |
| `Tab` | Select the next party member (wraps); the camera slides over them | — |
| `Space` / `Enter` | End the party's turn: the GM acts | — |
| `Ctrl+Z` / `Ctrl+Shift+Z` | — | Undo / redo |
| `Ctrl+E` | Switch to edit | Switch to play |

Selecting a character - their card in the party column, `Tab`, or a click on them - slides the
camera over them, keeping its angle and distance; so does coming out of a portal, once any walk up
to it has finished. An ordinary click to walk leaves the camera where it is; hold the button to have
it follow.

A press that moves less than six pixels counts as a click; anything longer is a drag. The tile
under the pointer is marked so a click has a visible target. The camera keys (WASD, arrows,
Q/E) are ignored while a text field has focus; the other keys are not (see Limits).

### The screen

- **The board**: each creature has a thin line round it in its side's colour - blue for whoever is
  selected, white for the rest of the party, red for anything hostile, green for anybody friendly (a
  bystander, a merchant, one talked round), and yellow for an enemy an End a fight stood down, which
  turns red again when the next fight begins. The line sits dim until the pointer finds it.
- **The Duality Dice** (over the board, when a party member rolls): two d12s —
  gold for Light, violet for Shadow — tumbling and settling on the faces that were rolled, with the
  sum and the outcome on a pill underneath. They are a view of a roll that has already happened, not the roll itself:
  the rules resolve, and the dice are then told what to land on, so nothing waits for them and
  a seeded replay shows the same faces. Only the party's Duality rolls are shown — an adversary
  rolls a single d20, and the log says what it did. Several at once (a feature everyone has to
  dodge) queue and are shown in the order they were rolled.
- **HUD** (down the left edge): one card per party member — name, class, and pips for HP, Stress,
  Armor, and Light (each bar one slot, lit when marked; Light wears the Light die's gold), any
  conditions, and a line naming what they wield and wear. The selected card has a gold border; a
  fallen member is dimmed. Clicking a card selects that character. A gold **Level up** button
  appears on a card when a level is waiting (see Levelling up). The strip beside them is the GM's:
  "Exploring" or "Round N", and the **Shadow** pips in the Shadow die's violet.
- **Play panel** (bottom right), top to bottom:
  - **Save / Save as… / Load**, small and grey until wanted.
  - **Journal**: every quest the party has been given. Active quests show their summary and
    their steps as ☐ / ☑; completed quests are struck through; failed ones say "— failed".
    Finished quests sink below active ones.
  - **Carried**: the party's shared pack, with counts (×N) and what each thing is worth. A weapon or armor item that points
    at SRD gear shows an **Equip** button.
  - **Log**: the narrative log, most recent twelve lines, coloured by tone (see tones in §4).
  - The conversation itself is not here: it is along the bottom, where the cards are (below).
  - **Roll prompt**: "Roll finesse +2" / **Step back** when a script is waiting on a roll;
    a list of option buttons when a script asks for a choice.
  - **Use what is in reach**: shown when the selected character stands next to an object.

### Turns: exploring and fighting

Out of combat there are no turns. Click the ground to walk the selected character anywhere the
floor goes - nobody counts steps. The others **follow down the ground the walker covered**, a pace
further back each, so the party reads as a line however it was moved: one long click, or a held
button steering in short steps. Whoever the trail does not reach yet stays where they are rather
than hopping to a free tile nearby; only somebody left far behind, or somebody the leader is walking
into, is moved. **Hold** the button instead of
clicking and they walk towards the pointer for as long as it is down, at a walk - the same pace a
click sends them at, no faster - with the camera settled on them for as long as the button is down
and nowhere else: a click walks somebody and leaves the view exactly where you aimed it, because a
camera that slides on every click is one nobody can aim. Holding is what says "come along": that is how the woods are crossed, rather than by clicking along the
trail. Steering follows the pointer wherever it goes, even off the room's edge. In a fight it keeps
inside the circle and stops at its edge, because leaving the circle is an Agility Roll and a roll is
something you decide on with a click. A press that does not linger is still a click. **A click
during a walk interrupts it**: the character stops on the ground they have actually reached and
sets off again from there, rather than finishing the first walk or sliding back to join a line
drawn from where they were headed. The others stop with them, so the party keeps its order.
Walking onto a trigger cell
starts that cell's encounter and the mover stops on the trigger rather than running past the
ambush.

**Who follows** is the cards. The party walks as one until you **drag a card out to the side**
of the column: put down there, that character stands where they are while the others go on - to
hold a door, to stay out of a trap, to scout alone. **Drop a card on another** and they walk with
that character, their card falling in under theirs. **Drop a card between two** and the party is
read in that order from now on - and where the two either side walk together, so does the one put
between them, so any grouping is a few drags. A **chain** passes behind the cards, linking everybody
who walks together: it runs down the middle of the column, under the sheets, and shows in the gaps
between them - one chain per run of cards side by side in the same group, in that group's colour,
and no chain at all for somebody who walks alone. A card whose group has been split up the column -
somebody else's card in between - has no chain reaching it, and wears a tab in its group's colour
down its edge instead. A card dragged out of the middle of a group goes above that group rather
than staying in the hole it left, so the ones still walking together stay side by side and their
chain stays whole. The chain is put away while a card is in the hand. A click on a card still selects
it.
Neither the groups nor the order are written into a save, and everybody walks as one again after a
load.

These rules are not played on a grid, and neither is this. Distance is as the crow flies: a
creature standing corner-to-corner is in Melee like one standing straight ahead, and the range
bands (Melee, Very Close, Close, Far, Very Far) are circles round whoever is measuring - round
*where they stand*, not round the middle of their square. A swing, a spell on somebody and a
reaction to somebody all measure from one body to the other, and each band reaches half a tile
past its number (Melee is within a tile and a half), which is what "to the nearest tile" always
came to. So half a step can be the step that brings somebody into reach, or takes them out of it.
**A click at your own feet is a step**: within half a tile of whoever is selected, the ground is
ground, and they shuffle to the spot - up to a wall, out of a line, a lean towards somebody - as
small as a twentieth of a tile. The others stay put for it. In a fight it is still a move, and
spends what a move spends. (What a spell lays on the *ground* - a ring, a cone - is still laid
on whole tiles, and catches whoever's tile it covers.) In a
fight a character moves inside a **circle**, drawn on the ground as the circle it is. When the
spotlight comes to the party, each character's circle is drawn round where they are standing, at
Close range (four and a half tiles out from where they stand, the demo's number), and **inside it they move freely** -
as often as they like, to any spot, at no cost, and the circle stays where it was drawn rather than
following them. A click past its edge is a **push**: an Agility Roll (Difficulty 12) that widens
the circle one distance step, Close to Far to Very Far, for the rest of the turn. The card says
what it opens and what it costs before you throw: on a **success** the circle is Far and they walk
towards the spot as far as it now allows; on a **failure nobody moves, the spotlight passes to the
GM, and the turn is over** - as any failed action roll ends it. A success with Shadow walks first
and then passes the spotlight, as the rules have it. Calling the roll off costs nothing. Past Very
Far there is no further push. The fainter ring outside the circle is the ground a push would open.
A click on the ground is a spot, not a square: the character walks
there in a straight line where nothing is in the way, stops where you clicked (or as near as
their body fits, clear of walls and of everyone else), and the others fall in a pace behind along
the line, round the same corners. Hovering the ground draws the line a click would walk, and the
line is **coloured by range**: green for Melee, cyan for Very Close, indigo for Close, magenta for
Far and near-white for Very Far, changing colour at each step so the line says how far as well as
where. The distance is measured along the line walked, not across the gap - a way round a corner
breaks colour later than a straight one to the same place, because that is what the walk costs.
Mid-walk the line starts at the figure rather than where it was sent, which is where a click will
start it from - and it keeps up with them: hold the mouse still while somebody walks and the line
shortens under it as they close on the spot, because it is redrawn from wherever they have got to
rather than from wherever they were when the pointer last moved. In a fight the part past the circle is drawn in amber where a push could open it,
or red where nothing could - those two are verdicts rather than distances, so they ignore the
bands.
Out of a fight a click beyond reach is not refused: it walks up to the nearest reachable spot (the
shut door, the edge of the chasm). A click on an enemy across the room walks
up to where the weapon reaches from and swings, the move being part of the action; with nowhere
in reach inside the circle, it closes as far as the circle allows - for free, the swing still to
come once something opens the way. A creature on the GM's
turn moves by the same rule, without rolling: it swings after a walk within Close, and when no
walk within Close brings its weapon to bear, it spends the turn walking as far as Very Far. A walk that wakes
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

### Height, steps and jumps

Ground can be laid from tiles - the demo's is - and then how high each piece stands is the
ground. A creature stands on the top of whatever is stacked on its cell. Heights are counted in
**blocks**: a block is one tile up, a floor tile is a quarter of one, a flight of stairs stands
you halfway up it.

- **A step** is any rise or drop of half a block or less: a floor tile on a floor tile, a flight
  of stairs, the two slabs of painted ground the old maps called a ledge. Walking takes it
  without comment, and the path found is found the moment a tile is placed.
- **More than a step is not walked.** Three quarters of a block or more - a whole block stood
  beside a floor tile - stops a walk. A click on the ground is only ever a walk: clicked on top
  of a block, the character walks to the foot of it and stops. **Nobody jumps unless told to.**
- **The Jump button** is a key beside the Light, the twin of the Rest key next to it, and it
  works at any time, in a fight or out of one. Armed, the key stays pressed and its face goes gold. Press it and the jump is aimed from where the selected character stands:
  everywhere in range lights up, level ground included, and an **arc** follows the pointer -
  gold where the jump can be made, red with an X where it cannot. Click and they fly it. Press
  the key again, or Escape, to put it down.
- **Past their range** the spot can still be aimed at. Then, and only then, a walk comes first:
  the line on the ground to where the jump can be made from, and the arc from there. The
  run-up stops the moment the landing comes within range - part-way into a tile, not at the
  middle of one - and in a fight it is as far as one move goes. **A right click** while the
  jump is being aimed puts it down, as Escape does; so does a right click while a card is aimed.
- **How far**: 3 tiles at Strength 0 or less and one more per point, measured from where they
  stand to the spot the pointer is on - a jump is aimed at a spot, as a walk is, and that is where
  they come down (or as near it as a body lands clear of whoever is beside it). A tile is lit
  when its middle is in range; the near side of the next one may be too, and the arc says so. **How high**: one block at
  Strength 0 or less and one more per point - +1 jumps two, +2 three - measured from where they
  stand to where they land. The arc goes over people and over anything lower than it passes,
  and is stopped by what stands higher, by a kind of tile that says it is impassable, and by a
  shut door.
- **The roll**: a jump across level ground asks for nothing. One that climbs more than a step
  asks for **an Agility Roll, Difficulty 12**. They land either way; on a failure they land
  **Prone** - rolls against them have advantage until they next move, which is them getting up.
- **A jump is made alone.** Whoever was walking with the jumper follows the run-up to where the
  jump is made from, and stops there: the jumper lands in a group of their own ("Quim goes on
  alone: the others stay where they are."), so walking them on afterwards walks them alone rather
  than bringing everybody round the long way. Drag a card back onto the chain to walk together again.
- **Down** is never refused. A drop of 1 + Agility blocks (1 at Agility 0 or less) asks for
  nothing. Past that the fall is rolled for: Difficulty 12, one harder for every two blocks past
  safe, and a d6 of direct physical damage for each block past safe - halved on a success, all of
  it and Prone on a failure.
- **A wall** along a cell's edge closes the cell at a block high, to feet and to sight. Lower
  than a block it is stepped over and only gives cover: set the piece's **height** to a half or
  three quarters before stamping it, and the wall is drawn that tall and walked that way.
- In a fight the jump is the action, as a run's roll is. Adversaries do not jump.
- **Every number above is the project's to change**: Content → Tiles → **Height and jumping**
  (§3). What is described here is what a project plays by when it has said nothing.

### Being hurt

Losing Hit Points shows in two places at once. **On the board** the token is knocked - a swell
on the blow, a recoil that rocks and dies away - and the line round it burns red and wide for
as long as that takes; a number rises over its head as it always has. **On the sheet** the
character's card is jolted the same way and flushes red from its edges, the number lost rises
off it, the portrait flares, and the hearts that went break - red, large, then settling into
the outlines they now are. A second blow before the first has faded starts over.

It is read off the sheets, not told to them, so anything that marks a Hit Point shows: a blade,
a fall, a trap, a spell's price. Healing is not a wound. A wound that came with a move - a fall -
is the landing's: the token flinches when it gets there, and when the move is waiting on a roll
you are still reading, both wait for **Accept** with it.

### Your settings

**Escape** opens your settings: a sheet over the table, and the only way to it - there is no
button for it on the board. Escape already means "put that down" everywhere else, so it opens
the settings only when there is nothing to put down: with the loadout open it shuts the loadout,
with a card or a jump being aimed it calls that off, with a roll on the table it is the roll's.
Escape again, **Close**, or a click outside the sheet puts it away. While it is up the keyboard
is its own: Tab walks its switches rather than the party.

What it holds is yours rather than the campaign's. It is kept in this browser (`localStorage`),
so it is there for every project and every save opened in it, and it is written into neither.
Settings sit under headings, and there is room for more of both.

- **Dice → Roll jumps automatically** - the dice for a jump are thrown at once, without the
  prompt between the click and the roll, and the jump is drawn at once. The roll is still made,
  logged and paid for. Off to begin with - and off, a jump you roll for by hand is not drawn
  until you have read the result and pressed **Accept**: the card holds the dice, and the
  character stands where they were until it is put away.

### The hand

Along the bottom of the screen the selected character holds their hand, fanned like a deck-builder's:
**Attack** with the weapon in hand (click an adversary on the board), then one card per action or
reaction — the class's Light feature, subclass cards, and the domain cards in the loadout. A card
grows where it stands under the pointer, its neighbours sliding aside, so its whole text can be read; its Light cost is the gold
coin printed on the art and its Stress cost the violet one beside it, in the corners the full card
prints its recall cost in and clear of the card's name. A card that cannot be played now is greyed,
with why along its foot ("needs 3 Light", "the GM's turn", "nothing in range", "the table
adjudicates this one" for a card the engine has no script for). **Every card the loadout holds is
in the hand**, including the ones that are simply true while they are held: a card that is always
in play is dealt with the rest and says so along its foot, rather than being kept out of the hand
because there is nothing to press. The two dice at the hand's left are the pools, turned from the same solids the Duality Dice are
thrown from: a yellow six for the selected character's Light, read in black, and a black twelve for
the GM's Shadow, read in white, with the most each can hold written under it. Point at one and it
rattles where it sits. Neither is labelled - the shape and the colour say which is which, and hovering
one names it. The round, or **Exploring** out of a fight, is written under the pair. To their right
sit the **Jump** and **Rest** keys, and at the hand's far right **End Turn** in a fight, **Rest…**
out of one, and **Loadout…**.

**Escape** opens the menu: saving, loading and the player's own settings, on a sheet over the
table. **Save** is one quick slot, overwritten; **Save as…** names a new one; **Load** lists what is
saved, newest first, and loading one shuts the sheet. Escape closes it again. Escape means "put that
down" everywhere else in the game, so the menu only opens when there is nothing to put down: mid
conversation, or with a card aimed, the key belongs to that instead.

The screen gives the cards the room they need. The party's sheets, the journal column and the keys
are sized from the window, and on a window too narrow to hold a hand of cards beside the journal,
the journal moves above the cards rather than squeezing them. The fan closes up as it fills, so a
hand of eight overlaps more than a hand of four without any card shrinking out of legibility.

An ability that wants a target and has more than one in reach arms the hand — the card stays
lifted, the rest dim, and the valid targets light up on the board; click one, or `Escape` to put
the card down. With exactly one target in
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
supports keyboard navigation and a two-column layout on phones. The hand wears the same
picture on each card: a domain card in its domain's colour, and one a character has without
choosing it in the colour **Always in play** gives it.

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

**Always in play**, between the hand and the vault, is what a character has without choosing it:
the cards their class, their subclass (up to the stage reached), their ancestry and their
community grant, and any a project hands them, in the order a sheet lists them. Last come any a
condition on them lends, while it lasts: a spell cast on an ally can leave them its other half to
answer with, and the card goes when the condition does ("Lent by Hidden"). They are face up,
no limit counts them, they are never vaulted, and each says what granted it. A search reaches
them; a domain filter puts them away, since none of them has a domain.

### Using things

Stand next to the object (one tile, diagonals count) and either click it or press **Use what
is in reach**. Clicking one that is further off walks the selected character up to the nearest tile
it is in reach from, and uses it from there once the walk has ended - a chest opens, a door swings,
a conversation begins only when they are standing there; the same for a click on somebody to talk
to. Out of a fight the rest of the party walks up behind them, as on any other walk; in a fight
they go alone. A right-click on the way, or a new order, calls it off: they stop where they have got to, and
nothing is used or said. Out of a fight they walk anywhere the floor goes, in a fight only as far
as the turn's move, the same as a click on an adversary walks up to swing. When nowhere
they could walk is in reach of it, nobody moves and it reads "It is out of reach." Using something in a fight spends that
character's action ("There is no time — you have acted."). An object that needs a key the party
lacks prints its locked text. Otherwise its roll-free effects run, then its check, if any, asks
for a roll. An object that starts a conversation opens it here. A used pillar or opened chest
refuses a second use.

What a prop does decides what using it is (see *What a prop does*, §3). A **container** opens a
window over the play panel listing what is in it, each line with a **Take** that moves one into the
pack; what is taken stays taken, in a save as in the room, and the window closes when the one who
opened it walks away. A **door** swings open on its front-left edge and stops blocking; used
again, it swings shut - unless somebody is standing in it ("It will not shut with somebody in the
way."). A **trapped** prop asks for its roll, then does whatever its success or its failure does.
A **portal** sends you to the other portal with the same pair id: out of a fight the whole group
steps out beside it, in a fight only the one who used it. Nobody walks the room between: each one
spins down to nothing where they stood and spins back up beside the other end, and a click on a
portal out of reach walks up to it first and goes through once there; if the other end is in another room,
the party travels there and arrives beside it.

### Conversations

A conversation takes the place of the cards along the bottom of the screen - what is said on the
left, the replies on the right - and the Jump and Rest keys and the cards step aside until it ends;
the Light, the Shadow, the round and the Loadout stay. The camera centres and draws in on whoever
(or whatever) you are talking to and is held there: the wheel does not zoom and a drag does not pan,
but you can still turn it (Q / E, or a drag with the left or middle button). When the conversation
ends the camera goes back to where it was looking. A conversation shows its lines and the replies you may give. A reply can be hidden until the
party knows something, shown but greyed ("Not available"), cost a roll (the roll prompt appears
inside the conversation), or end the conversation. A node's lines are also written to the log.
A conversation is the character's who is having it, not the whole party's. While they are selected
everything else waits for it; select somebody else - **Tab**, their card, a click on them - and
it steps aside: the conversation leaves the screen, the camera lets go, and the rest of the party
carries on as usual, while the one talking stands where they are, marked *In conversation* on
their card. They are still in their group, but they take no orders and the others walk off without
them. Select them again and the conversation is back where it was - with the shop it had open, if
it had one - and when it ends they are free. The party cannot save or rest while anybody is in the
middle of one; a fight that begins breaks off any conversation set aside ("Quim breaks off the
conversation."), and so, without a word, does the party leaving the room or a save being loaded. In a fight a conversation holds the whole table, as a
creature's surrender does. Esc does not close a conversation: it opens the settings over it.

Some creatures talk. A **friendly** one stands on nobody's side - a green line round it, not red - and
clicking it walks up and opens its conversation instead of attacking; stepping on its encounter's
trigger wakes nothing while every creature in it is friendly. Another fights until a blow leaves it
with its **threshold** share of Hit Points or less: then it lowers its guard ("Rot Hound lowers
their guard."), the fight holds - nobody takes a turn - and its conversation opens. What the
conversation decides stands. Spared, it stays out of the fight, and if it was the last who wanted
one the fight is over ("Nobody is left who wants a fight. It is over."); turned back, it rejoins
the fight ("… turns on the party!"), or starts one if none is running. A creature stops to talk
at its threshold only once, and a blow that kills it outright is a defeat, not a surrender.

### Rolls

An action roll is two d12: the Light die and the Shadow die, plus the trait modifier, against a
Difficulty. The log reads it out, naming only the parts that applied:

    Light 8 + Shadow 7 + 2 = 17 vs 12. Success, with Light.

Extra parts appear as `+ d6 N` / `− d6 N` (advantage or disadvantage) and `+ help N`. The five
outcomes are critical success (both dice match), success with Light, success with Shadow, failure
with Light, failure with Shadow. A roll with Light gives the roller a Light; a roll with Shadow gives
the GM a Shadow; a critical also clears a Stress. All three happen when the roll is made -- on an
attack, before anything is played on its damage roll, so such a card can spend a Light the roll
just gave, and a critical's clear never takes back a Stress such a card marks. **Step back** declines
the roll at no cost: the
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

**Buying.** A merchant's conversation, or a prop that is a shop, opens a window of what it sells:
each thing with its price and a **Buy** button, and a line saying how much the party has of what it
is paid in ("You have 20 gold."). Buying takes the price out of the shared pack and puts the thing
in it ("Quim buys Healing Draught for 6 gold."); a Buy the party cannot afford is greyed out, and a
thing a shop has only so many of is gone once they are bought - still gone after a save. The window
opens in the middle of the screen, over everything, with the room dimmed behind it, and has to be
closed - its ✕, or a click outside it - before anything else goes on: the conversation that opened
it waits, its replies greyed under "Close the shop to go on.", and the board cannot be clicked
through it. The **Loadout** book stays above the dimming, so the party's cards can still be looked
at mid-shop, and Esc opens the settings over it, as it does over a conversation.
**Selling:** the window's **Sell** list is what the party carries that the seller will
buy, and what it pays ("Sell · 3 gold") - its share of its own price for something it sells, which
goes back on its shelf if it had only so many, and of an item's worth for anything else. The share
is half unless the shop says otherwise: a fence may pay a quarter, a temple the whole worth. Always
rounded down, never nothing; a key, a quest's token, the coin itself - anything without a worth -
it will not buy. In the default project Tobin pays four in ten (a husk carapace fetches 1 gold, a
longsword 6), and says so; beside him **Wren the Wandering Bard** gives the party a quest, The Lost
Verse - her songbook, in a crate inside the vault - and pays 15 gold for it through a consequence
in her conversation: conversation, consequence and trade in one camp. The
**Carried** list says what each thing is worth ("Healing draught · worth 6"), so a player knows what
it will fetch before walking up to anybody. In the default project Tobin the Pedlar sits by the
camp fire south of the vault, and the camp's crate holds 20 gold to spend with him.

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
| **Project ▾** | Save JSON · Load… · Import pack… · Export pack · Check (lists what the validator finds; a red badge counts errors) |
| **Content ▾** | Party · Cards · Items & loot · Quests · Code · Models — each opens as a workspace under the bar; the back arrow before its title, or `Esc`, returns to the board |
| **Inspector · Terrain · Combat · Interaction** | The four modes, also on keys `1`–`4` |
| **The scene button** (shows the room's name and size) ▾ | Every scene with its size; **▸** marks the one the project opens on and **●** the one the party is in. Click to edit it; **✎** renames, **▸** makes it the opening scene, **✕** deletes (refused for the opening scene or the last one); **+ New scene** adds a blank 12×10 room |
| **Undo / Redo** | The same history as `Ctrl+Z` / `Ctrl+Shift+Z`; hover for what it would undo |
| **▶ Play here / ▶ Play** | Play in this room from its spawns (Shift-click a tile to play from there), or go back to where the party is |

Centred under the bar is the **frame rate**, counted from the frames actually drawn rather than
estimated. It takes no clicks, so the board stays reachable straight through it.

`Esc` closes the nearest thing: a menu, the problem list, a workspace, a conversation, then the
selection.

### The modes

| Mode | Around the board | What a click or drag does |
|---|---|---|
| **Inspector** (1) | The selected thing's properties, on the right | Click a prop to see what it is drawn with, what it does and whether it is solid (an object from an older project is shown as it always was). Press on anything placed, a creature, a prop, an object or a party start, and drag to move it: it lifts off the ground, hangs under the pointer with its bottom swinging behind the way it goes, and drops with a bump where you let go, at the height it stood. It never lands on another of its kind (props stack), and a party start stays in the room; one undo puts it back. The editor draws a party start as the character who begins there - party member 1 on start 1, and round again if the party outnumbers the starts - in the model play gives them, rimmed in white; a start nobody fills is a blue pawn in a ring. Click a start and the side pane shows that character's sheet, the same form as the Party workspace, and an edit there is an edit to the party. An object with no model is a gold ring with a gem |
| **Terrain** (2) | Tools on the left rail; **Tiles** and **Props** in the strip along the bottom; the tool's options on the right | Build stacked tiles anywhere (brush 1×1, 3×3, 5×5); erase tiles at a chosen level; raise/lower ground; place props; **Select** picks up a placed tile - the topmost on the cell - and carries it: the Z ladder goes to its level, the wheel lifts it while held, Alt turns it, and it lands where you let go, on top of whatever is there. One undo puts it back. With Select in hand the **Z ladder** stays out: it shows the height of the prop or tile Select last took hold of and raises or lowers it, a quarter tile a rung, each an undo step - or is the build plane when Select holds nothing. Kinds of tile are named for the model they are drawn with (Grass Ground, Stone Stairs, Stone Block, Stone Wall, Dirt Ground, Grass Dirt Ground; the three drawn with the stone block say which is which) |
| **Combat** (3) | Tools on the left rail; the SRD's creatures by tier in the strip, with a search; the encounter on the right | Place the picked creature in the encounter; press on a placed creature and drag to move it, as in the Inspector (Select carries party starts too); toggle trigger cells that start it; toggle party start tiles; erase a creature, then a trigger cell, then a party start (never the last one). The selected creature's panel ends with **Interaction**: None, **Friendly** (on nobody's side until its conversation says otherwise; clicking it in play talks) or **Threshold** (fights until a blow leaves it at or under the **% of Hit Points** given, 50 to start, then stops the fight to talk - once), and the **Conversation** it opens. Friendly and Threshold need a conversation to exist first. **Sells things** gives it a shop: what it is **Paid in** (gold to start), what it **Buys back at** (the share of a thing's worth it pays when the party sells, as a %: empty is 50, up to 100, 0 buys nothing), and a line for each thing it sells with a **price** and **how many** (empty is no end to them); its conversation opens the shop with **Open a shop** in a reply or a consequence node |
| **Interaction** (4) | The conversations, on the left | Click one to open its graph |

Opening a Terrain library tab chooses the placement action automatically: Tiles builds and Props
places props. There is no Objects tab any more: a door, a chest or a portal is a prop with a
function (see *What a prop does*). Picks are remembered when switching
tabs. The rail only offers the applicable erase or raise/lower actions; there is no separate
placement-type selector. Clicking the tab or an item returns from erase to placement. Every card
shows what it puts down: a picture of the model for a prop or a creature (one with no model of its
own shows the husk that stands in for it on the board, marked **stand-in**), and for a kind of tile a picture of the model it is drawn with - its declared colour for a kind that names no model, and while the picture is being drawn. The Tiles tab offers only kinds that are
structures: ground is the substrate every cell already holds, edited in the Tiles workspace, and is
not something the placer puts down. A name too long for its card wraps to a second line. A tab with nothing in it
is dimmed and says so ("Nothing in Tier 3 yet."); "Nothing matches." is only ever a search's answer.

### Building tiles beyond the board

Open **Terrain → Tiles** and choose Block, Floor, Wall or Stairs. Pick stone, wood or grass
on the right, then click or drag on the build grid. The translucent piece previews
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
the arrows still pan the camera. Page Up/Down moves a whole tile, **Ctrl + wheel** a quarter tile
with the pointer anywhere over the board, and the box underneath takes
exact heights out to ±1,000,000 — past anything the ladder draws. The separate
**Piece height** field scales a piece vertically, from 0.25 to 16; floors start
at a quarter-tile thickness. **Hold Alt and drag toward a tile edge** to point tiles or props
in that cardinal direction. The camera angle is accounted for, so dragging along the visible
grid chooses the matching north, west, south or east edge. While Alt is held, the tile preview stays in place and
mouse gestures do not stamp pieces or pan the camera. Release Alt, then click to place with
the chosen facing.

**While the Props tool is held, the prop under the pointer is drawn where it would go**, half
see-through, at the size and facing it would be placed with. It is the same model seated the same
way, so what is previewed is what lands; it disappears when the pointer leaves the board or the
tool changes.

A prop can also be placed across **more than one tile**. With Props open, the **Size** buttons -
1×1, 2×2, 3×3, 4×4, 5×5, 6×6, 8×8 - choose how many tiles across the next prop is drawn, and the
same model is then drawn at that size: one boulder covering nine tiles rather than nine boulders.
The tile you click is the block's **north-west corner**, and after that a click anywhere in the
block turns or erases the whole of it, so a 3×3 is picked up by its middle as readily as by its
anchor. It is scenery at any size: a walk goes straight through a prop, and what the ground under
it costs is still the Tiles workspace's to say. A prop of the ordinary size writes nothing about
its size into the project, so a room full of one-tile props reads exactly as it always did.

**Placing a prop takes hold of it**, and so does clicking one that is already down, and so does
picking one up with **Select** - the panel
then says which prop it is showing, and **Size** and **Rotate** change *that* prop as well as
setting what the next one will be placed like. A second click on a prop already being shown turns
it, which is the old behaviour; the first click no longer does, so reaching for a prop's settings
cannot spin it by accident. Picking anything from the Props strip lets go again, because reaching
into the strip means placing something new. Erasing a prop lets go too. A prop of any size can be
dragged like any other, and it is carried at the size it is drawn at: the lift's stretch is a
factor of whatever it already was.

**Solid** says whether the prop stops a walk. Off by default, which is what a prop has always
been: scenery a walk goes straight through, with the ground under it saying what it costs. On, the
whole block it covers is barred - nothing walks through it and nothing sees through it - so a
boulder drawn across three tiles is an obstacle three tiles across. The floor under it is left
where it is, so the prop goes on standing on the ground rather than on top of its own block. Like
Size, it applies to the prop being shown as well as to the next one placed. One caution: nothing
can find a way *off* a barred tile, so making a prop solid while somebody is standing in it walls
them in where they stand - mark it solid before the party walks through, or move them out first.

**Save as remix** keeps the settings in hand - the model, the block, the facing and whether it is
solid - under the name typed in the box beside it, or, left empty, the name the box shows greyed,
like *Crate Prop 2×2* (or *Rock 3×3 · solid*, since whether a prop is an obstacle is the one setting
that cannot be seen on the board). Saving the same settings again under a new name renames the
remix that holds them rather than making a second. While a remix is picked its name is in a box
of its own: change it and press Enter (or leave the box) to rename it, one undo step; empty it and
it takes the name it would have been given. The remix appears in the Props strip beside the models, drawn with its own
model's picture. Picking it sets all three at once, so another six-tile boulder facing north is
one click rather than three. What a remix places is an ordinary prop: **Remove remix** forgets the
settings and leaves everything ever placed from it exactly where it is. Remixes belong to the
project, not to the editor, so they travel with the file to whoever opens it next.

### What a prop does

Any prop can **do something**. The Props panel's **Function** select, under Size and Solid, offers
**None** - chosen until something else is, and what a prop has always been - and then:

- **Container** — used, it opens a window of what it holds. Add things one at a time from the
  project's items: the same item added again is one more of it, and **−** takes one away.
- **Door** — stands in the way until it is used, then swings open on its front-left edge and
  lets the party through; used again, it swings shut.
- **Trapped** — asks for a roll: a trait and a Difficulty (1 to 40, 12 to start), and
  **Repeatable** if it should ask again every time rather than once. Below them are two more
  Function selects, **On a success** and **On a failure**, both None to start; each can be any
  function, a trapped one included, with settings of its own.
- **Portal** — one of a pair. Give it a **pair id**; the portal given the same id is its other
  end, in this room or any other. A pair is two: an id two other portals already hold is refused as
  it is typed ("… already pairs A and B. A pair is two - choose another id."), and a portal with
  nobody holding its id says it is waiting for its other end.
- **Interaction** — opens a conversation, picked from the project's; its replies and consequence
  nodes decide what comes of it. With none picked it says nothing, and Check says so.
- **Shop** — sells things: the same **Paid in** and stock lines as a merchant (below, under Combat),
  and using it opens its window. Check flags a shop that sells, or is paid in, an item the project
  does not have.
- **Script** — everything an object could be told: name, flavour, a key it needs, effects with no
  roll, a check with its five outcomes. The demo's quest things - the lever that starts a quest,
  the pillar that ends one - are Script props.

A prop that does something gets an **id** when it is placed (its model and its tile, *crate-prop-3-9*),
which is how a portal names its partner, how an effect names what to open, and what a save
remembers its state by. Like Size and Solid, the function applies to the prop being shown and to
the next one placed, so the second portal put down after the first takes the same pair id and the
two are a pair at once; a third comes down with no pair id rather than a refused one. A remix
keeps the function too.

A function prop blocks by what it is, not by **Solid**: a door blocks until it is open whatever
Solid says, and a container blocks only if Solid is on. A prop drawn across several tiles is used,
reached and blocked across all of them - a 2×2 door is one door two tiles wide. In the Inspector,
clicking a prop shows the same Function select, the model it is **Drawn with** (any model the
project has), and **Solid**.

A project from before the merge loads as it always did: each object becomes a prop drawn with the
body its kind always had, holding a Script function with everything the object was told, and
keeps its id. An object with no body at all (an invisible trigger) stays an object.

**R** and **Rotate** also turn tiles and props; the four **Wall edge** buttons
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
its stat block. A name is what play calls it - the log, a roll's prompt, a shop's window - and the
right-click card shows the name with the stat block under it (*Captain Vey*, "Foe · Tier 1
standard"); a creature with no name of its own is called by its stat block. A name changed while
the game is running reaches the creature when you return to play. **Check** warns about a model name nothing can supply — the creature still plays, it
just stands in a borrowed body.
Every entry into a room brings its creatures up to date with the document: returning to play,
travelling in through a door, or loading a save each add the creatures placed since and remove
the ones deleted since, keeping existing wounds, party pools and anything a script has already
taken off the board. A creature placed outside the board is drawn in the editor and reported by
**Check**, but it does not enter play: outlying and elevated authoring still needs multilevel
navigation before it can be fought on.

Right-drag or WASD/arrows pan; middle-drag or Q/E orbit; the wheel zooms. **Go to coordinates** jumps to a
distant build, including negative coordinates. **Home** returns to the original map.
X, Y and build level each support −1,000,000 through +1,000,000. Empty space allocates nothing;
memory and saved file size grow with the number of placed pieces, not the distance between them.

Nearby pieces have beveled edges, middle-distance pieces use simpler geometry, and far stairs
become solid silhouettes. Chunks outside the viewing range unload automatically. On a dense
view, the nearest 96 visible chunks take priority and load progressively.

**A kind of tile laid outside the room makes the room bigger.** Lay a platform past the edge
and, when you let go, the room grows to hold the stroke: what you laid is floor, and the party
can walk out onto it. The rest of the rectangle the room had to grow by is **nothing** - not
drawn, not walked on, no bar to a line of sight - so a platform standing off on its own is an
island, with a gap round it that a jump can cross and a walk cannot. Fill the gap with more
tiles and it is a bridge. It happens at the end of the stroke, the camera slides with the
ground so nothing on screen moves, and **one undo** takes back the tiles and the growth together.

Growing west or north moves the room's first corner, so every coordinate in it goes up by as
much: spawns, doors, props, creatures, triggers and every piece. The Build X / Y boxes read the
new numbers afterwards. A game already being played in the room is stood up again round the
party where they stand, wounds and opened doors and all; a save made before the room grew puts
everybody back in the same places. The room does **not** grow while a fight or a question is
in progress - the tiles are laid, as scenery, and the next stroke outside will take them in.

A room grows to at most 128 tiles on a side. Anything laid further off than that stays what it
always was: scenery, drawn and never walked on. Pieces that are not a kind of tile, and erasing,
never grow anything; and a room never shrinks again on its own.

### Height and jumping

**Content → Tiles → Height and jumping** holds the house rule for height, beside the kinds of
tile that make height. Whether anybody jumps at all; how much of a block a step takes; which
trait carries a jump up, how many blocks anybody makes and how many more each point adds; how many
tiles an aimed jump carries across the ground, and whether a level one is rolled for; the
trait and Difficulty of the roll; the same three numbers for a safe drop; how fast a fall gets
harder, what die it costs per block and whether a success halves it; and the condition a
failed roll lands them with, from the project's own conditions. Two lines read the numbers
back as a table would say them - "Strength 0 jumps 1, +1 jumps 2, +2 jumps 3."

Each field is one undo step. **Back to the defaults** removes the rules from the project
rather than writing the defaults into it. A step's height takes hold when play is next entered.
Check warns when the landing condition is not one the project has, when nobody without the
trait could jump at all, and when every drop past a step would be a fall that hurts.

### Objects and the inspector

New things are props with a function (*What a prop does*, above), and clicking one in Inspector
mode shows its model, its function and Solid. A Script prop's settings are what an object's were.
An object left over in an older project that has no body is still edited as an object; in
Inspector mode, click it. The inspector edits:

- **What it is** — Name; Flavour (read when used); Kind (chest, door, pillar, portal,
  scripted — only a door stops blocking its tile when opened); Drawn with — any model the
  project has, which is the library's plus every `.glb` in `public/models`, or *The kind's own
  body* to leave it to the kind (a `scripted` object has none, and shows the editor's gold
  mark instead); Blocks movement.
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
card, Spend tokens on a card, Push them back, Ask for a reaction roll, Run code, and **Change sides**
(friendly or hostile - by default the creature a conversation is with; a party member is never
turned, and a creature turned hostile with no fight running starts its encounter's fight), and
**Open a shop** (the shop of the creature a conversation is with, or of the thing being used). Scene,
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
  yellow border and ▸. **+ Node** adds one near the view; **+ Consequence** adds a consequence
  node, a dashed card with a gold label, which says nothing and does: its effects - **Run code**
  with a Code entry, **Change sides**, a flag, a fight, anything an effect list offers - and then
  goes on to the node its **then** names, or ends the conversation. A reply is pointed at it like
  any other node. The back arrow before the conversation's name returns to Interaction mode's
  conversation list.
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

All fourteen of the built-in props have been **retired** for models in that folder: the pine is `tree-prop`,
the dead tree `withering-tree-prop`, the barrel `barrel-prop`, the crate `crate-prop`, the brazier
`standing-torch-prop`, the cart `cart-prop`, the training dummy `training-dummy-prop`, the banner
`banner-prop`, the rock `rock-prop`, the campfire `camp-fire-prop`, the pillar `pillar-prop`, and the door, chest and portal `door-prop`, `chest-prop` and `portal-prop`. A project that still names an old one
is renamed as it opens, so nothing it placed turns into a placeholder; the next save writes the new
names. None of the built-in props remains. The pillar's top has a π carved into it that glows blue, in the file itself (`tools/add-top-rune.mjs`). The portal's opening glows and turns: the glow is in the file itself, an animated clip the board plays on a loop (`tools/add-portal-glow.mjs` put it there). The torches' and the campfire's flames glow the same way, from inside their files (`tools/add-flame-glow.mjs`), so they stay alight in shadow.

The other way in is the folder: a `.glb` dropped into `public/models` is a model of every project
the page opens - the built-in demo, the default project and any file loaded - named after the file
(`door-prop.glb` is `door-prop`). The dev server reads the folder when it starts, so restart it
after adding one. A project that already lists a model of that id keeps its own settings for it.

Each model carries three settings: **Scale** (a tile is one unit — most sample files are in metres,
so 0.01 is a common answer), **Ground offset** to sit its feet on the tile, and **Rotation °** to
turn it to face the way the built-in models do.

**Use the model's own pivot** says where a model is held from. Off - the default - it is seated:
centred on the base it stands on, its feet on the tile, whatever origin the file was exported
around, which suits a figure or a crate modelled anywhere in its file. On, the file's own origin
goes on the middle of the tile at ground level and the model stands exactly where its maker put
it: a wall modelled against one edge, a sign on a post set to one side. Scale, rotation, the ground
offset and the X and Y nudges apply either way; a wall held by its own pivot is not moved to its
edge, since its file already says where it stands. **Reset** puts it back to seated.

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
of the ones the engine ships (those live in `content/pack/starter-abilities.ts` and are edited in
code). **+ Card** writes two things as one undo step: a card of the project's own, handed to nobody
yet, and the ability on it; **✕** takes both back, leaving a card anything else still needs.
**granted by** says how that card gets into play: a loadout, named characters (**held by** lists
them), a class, a subclass stage, an ancestry, a community, the stat blocks that print it
(**printed on**), or a condition on whoever bears it (**lent by** lists the condition ids; the card
is in their hands while one of them lasts). A card in a loadout carries four numbers more -- its **domain** (one some class
opens), **type**, **level** and **recall** cost -- and the panel writes all four when a card is
switched into one; switched out again, the card keeps them. A card the pack prints says so, and
**Edit a copy** lays a copy of it into the project: a project's card replaces the pack's under the
same id, whole, so the copy is what the table plays from then on and the pack is never written.
✕ on its ability leaves the copy, still played; **Remove copy**, on the copy, takes it out, and
the pack's card is played again with the abilities on it where they were. **Check** warns when a grant
names something nothing defines, about a card given to nobody or printed on no block, and about a
chosen card in a domain no class opens or past level 10. A card is its
name, the text as printed, who holds it, whether it is an action, a
reaction (and what it answers) or passive, what it costs in Light, Stress and Shadow, who it can be
aimed at and how far, whether using it is the character's action, whether it is only for a fight,
whether it holds tokens and when they refill, what it resists, what it takes off the damage,
whether the swing its stat block prints goes through armour — and then the effect list, which
is the same one every other panel uses, including an attack's own reach and whether it goes
through armor, and a reaction roll's damage, which is rolled once before anyone rolls to avoid
it. A card with no effects is not broken: it is shown as text and the table
decides, exactly as an unscripted SRD card is. The **name** and the **text** are the card's as much as
the ability's: typing either writes both, so the action bar, the deck browser and a card's face all
say the same thing, and one undo puts both back. A pack's card keeps its words until **Edit a copy**;
a card two abilities sit on keeps its own, since one spell's words are not the grimoire's. Beside the
form, the card as the player will see it: a chosen card with its level, recall cost and domain, any
other with what grants it, redrawn as you type. **Use your own art…** under it puts a picture on the
card, kept in this browser as the deck browser's own import is (the two are one picture), and
**Remove** gives it back.

**Text only**, under the list, is every card no ability sits on: the pack's text cards and any an
imported pack brings without a script. Opening one shows the card's own **name** and **text** --
editable once it is the project's, so a pack's card needs **Edit a copy** first -- and how it gets
into play. **+ Script** writes the first ability on it, named and worded for the card, and the card moves up
into the list above, where its ability is edited like any other. A card of the project's own that
the pack does not print also has **Delete card**, one undo step; a character still holding it is
Check's to report.

### Items and loot

**Write an item…** opens the Items panel, which holds both halves of the pack because they only
mean anything together. An **item** is a name, a description, a kind (key, consumable, weapon,
armor, trinket), whether a second one stacks, what it is **worth** (in the coin shops are paid in -
a merchant buys it for half; empty, no merchant will buy it), and an effect list for what using it does — the
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

**The project that opens is a file: `projects/default.json`.** The page loads it every time it
opens, and while it is the project open, **Save JSON** (or `Ctrl+S`) writes it straight back - no
dialog - so whatever you changed and saved is what opens next time. Commit the file and your room
is in the repository like anything else.

- **No file yet** (deleted, or never made): the demo built from code opens instead, and the next
  save creates the file from it. This is also how to start over: delete the file, reload, save.
- **A file that will not load:** the demo opens instead and the reason is recorded in
  `__engine.errors`, and saving does **not** write over the file - it may be a great deal of work
  with one bad field in it. Fix the file, or move it aside, and reload.
- **`?boot=builtin`** on the address opens the demo from code and never touches the file, however
  often you save; `?boot=file` asks for the file on a server that would otherwise not.
- **A model imported and never used is not written.** The Models panel remembers every model
  imported in this browser and lays it back under the project each time it opens; a save writes
  the ones something in the project names - a prop, a creature or its type, a character, anything -
  and leaves the rest out of the file, still remembered here and still offered in the editor. A
  project that used none of four imported models once carried 80 MB of them.
- Writing the file back needs the dev server (`npm run dev`): it is the server, not the page, that
  writes to disk. A built site opens on the same file but cannot save into it, and a save there
  downloads the project as it always did.
- The file is not updated when the demo's code changes. It is your copy now; to pick up a newer
  demo, delete it and save, which replaces your edits with the demo from code.

With any other project open - one you loaded with **Load** - **Save JSON** saves to that project's
own file (asking where the first time, where the browser allows it; otherwise downloading
`<project-id>.json`) and never over the default. Either way it clears the "unsaved" mark. **Load** opens a file picker; the file is parsed through the project schema, and
if it is playable, replaces the document the *editor* holds, redraws the view, and restarts the
game on it — the same round trip described under **Playing what you authored** above. A file that
carries code the current project does not already run asks first, as Import pack does: it names each
new script, says code is not sandboxed, and a no loads nothing. Reloading the project you have open asks nothing; your saved project, loaded after a fresh boot
when the demo is what is open, asks once. A file
that fails the schema is recorded in `__engine.errors`, and nothing is shown under Project ▾.

### Exporting a pack

**Export pack** writes the project's content -- classes, ancestries, communities, subclasses,
cards, weapons, armor and adversaries, the abilities on its cards, the conditions they apply and the
code they run -- as a pack file named for the project (`<project id>-pack.json`). Nothing else goes
in: no scenes, no party. Because the code goes with it, importing the file anywhere asks first. **Import pack…** reads it back, into this project or another. It is not a save,
and the project is not marked saved.

### Importing a pack

**Import pack…** adds content somebody else wrote to the project being edited: classes, ancestries,
communities, subclasses, cards, weapons, armor and adversaries, plus the abilities that make its
cards do something and the conditions those abilities apply. Pick one file or several; each is read
in turn, and a message says what each brought.

- A pack is a JSON object carrying any of the lists `weapons`, `armors`, `classes`, `ancestries`,
  `communities`, `subclasses`, `cards`, `adversaries`, `abilities`, `conditionDefs` and `code`, each
  optional (`domainCards` in a file older than format version 3). A project file is a pack too: importing one takes its content and leaves its scenes.
- A pack that carries **code** the project does not already run (`code`, the scripts its cards run)
  asks first, naming each script.
  Code runs inside the game with everything the game can reach -- it is not sandboxed -- so accept
  only a pack from someone you trust. Declining brings in none of the pack.
- An entry whose id the project already has **replaces** it where it stands; anything new is added.
  The message says how many were replaced.
- One **Undo** takes the whole import back, and **Redo** brings it again. In play the game is
  rebuilt over what the step left at once; mid-fight or mid-conversation the step is refused, as the
  import is.
- An entry that cannot be read is left out and named in the message, and the rest of the file still
  comes in. A file with nothing readable in it, or one written by a newer build, is refused and
  changes nothing.
- A file written before the Light and Shadow rename is rewritten on the way in, as a project is.
- Each file is **one** undo step, however much it brings.

What was imported is the project's own from then on: the Party panel offers its classes and cards,
the Combat strip its creatures, and the **Cards** workspace lists its abilities to edit. Save the
project to keep it.

**A pack to try it with.** The build carries one at `/packs/ember-spells.json` (in the repository,
`public/packs/ember-spells.json`): open it, save it, and import it. Two ember spells, level 1, so an
Emberwright can take them from the Party panel. **Biting Circle** marks a Stress to burn a circle
round the caster; a foe that crosses into it takes 2d12+4 magic damage and is thrown back to Very
Close. **Echo Mark** spends 2 Light on an ally within Close; the next blow they land reaches the
nearest other foe the same roll beats. Each brings the condition it applies, so they work in a
project that never wrote those down.

### Undo

Every editor change goes through one command history: brush strokes coalesce per drag, typing
coalesces per field, graph drags are one step each. `Ctrl+Z` / `Ctrl+Shift+Z` or the buttons;
the buttons' tooltips name the step.

## 4. Content reference

### Project document

`formatVersion` (4) · `id` · `name` · `terrainPalette?` (id, name, passable, cost,
providesCover, blocksSight) · `scenes[]` · `dialogues[]` · `items[]` · `lootTables[]` ·
`quests[]` · `abilities[]` · `conditionDefs[]` · `code[]` · `party[]` · `jump?` · `startScene`.
All ids are stable kebab-case strings; duplicates are rejected.

**Jump rules** (`project.jump`, optional - a project that says nothing plays by the defaults and
does not write them down):

| field | default | what it is |
|---|---|---|
| `enabled` | `true` | Whether anybody jumps. Off, ground too high to step onto is out of reach, and no click is refused. |
| `stepHeight` | `0.72` | The most a walk climbs or drops in one step, in blocks. Everybody's pathfinding reads it, adversaries included. |
| `reachTrait` / `reachBase` / `reachPerPoint` | `strength` / `1` / `1` | Blocks a jump goes up: the base at 0 or less, more per point above. |
| `rangeBase` / `rangePerPoint` | `3` / `1` | Tiles an aimed jump carries across the ground, on the same trait. |
| `flatRoll` | `false` | Whether a jump across level ground asks for the roll too. |
| `rollTrait` / `difficulty` | `agility` / `12` | The roll a jump asks for. |
| `dropTrait` / `dropBase` / `dropPerPoint` | `agility` / `1` / `1` | Blocks down that are only a drop. |
| `harderEvery` | `2` | Past a safe drop, Difficulty +1 for every this many blocks. `0` for never. |
| `fallDie` | `6` | The die rolled for each block past safe, as direct physical damage. `0` for a fall that does not hurt. |
| `halfOnSuccess` | `true` | Whether a success halves the fall. |
| `failCondition` | `prone` | The condition a failed roll lands them with; empty for none. |

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
`spawns[]` (≥ 1), `interactables[]` (only bodiless objects, since format 6), `encounters[]`, `decos[]`, `fogBand?`, `buildingTiles?`.
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
`position`, `name?`, `hitPoints?`, `interaction?` - `{ kind: 'friendly', dialogue }` or
`{ kind: 'threshold', dialogue, percent }`, 1 to 99), `triggerCells[]`, `startsOnTrigger`. A **deco**: `model`,
`position`, `rotation` (radians), `id?`, `span?` (tiles across, from the north-west corner),
`solid?`, and `function?` - one of `{kind:'container', items:[{item, count}]}`, `{kind:'door'}`,
`{kind:'trapped', trait, difficulty, repeatable, success?, failure?}` (success and failure are
functions themselves), `{kind:'portal', pair}` or `{kind:'script', object, name, flavor,
blocksMovement, effects, check?, repeatable, requiresKey?, lockedText, goto?, tags, data}`. A deco
with a function must have an id, unique in its room. Format version 6 moves every object with a
body into `decos` this way.

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
| `close` / `toggleOpen` | `interactable?` | shuts it, or opens it if shut and shuts it if open; a shut door blocks again. Nothing shuts on somebody standing in it |
| `openContainer` | `interactable?` | opens the container window over what that prop holds |
| `openShop` | `of?` (whose; the one a conversation is with, else the thing being used) | opens that seller's shop window - the stock is on the seller, a Shop prop's function or a creature's `interaction.shop` |
| `teleport` | `pair` | sends whoever used it to the other portal holding `pair` |
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
| `startEncounter` | `encounter`, `intro?` | begins that encounter's fight, as a trigger cell does - the party first - when no fight is running and somebody in the room is hostile; logs `intro` or "Something moves." either way. A fight already running is left as it is: it already counts every hostile creature in the room |
| `endEncounter` | `encounter` | stops that fight when it is the one running (or its creatures are in it): "The fight stops. Nobody raises a weapon." Every enemy standing stands down - on nobody's side, saved - until the next fight in the room begins, when they are hostile again; a blow struck at one of them begins it. Creatures friendly by their own interaction are not touched |
| `goto` | `scene` | travel, taken once the script has stopped asking |
| `startDialogue` | `dialogue` | pauses the script, runs the conversation, then resumes |
| `setAttitude` | `attitude` (`friendly` \| `hostile`), `target?` (the one a conversation is with) | a creature onto nobody's side, or back among the adversaries; a party member is never turned. Hostile with no fight running starts the fight of the encounter that placed it |
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

A hook is JavaScript the project carries in `code[]` (`id`, `name`, `notes`, `source`): written in
the editor's **Code** panel, or brought in by a pack. Compiled with `new Function` when the project
loads and again whenever the text changes. The engine ships no hooks of its own -- a catalogue's card
code travels in its pack, and Import pack and Load both ask before code the project does not
already run comes in.

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

A **card** (`project.cards[]`, or a pack's `cards`): `id`, `name`, `grant` -- how it came to be in
play: `chosen` (picked into a loadout) \| `class` `classId` \| `subclass` `subclassId` + `stage` \|
`ancestry` `ancestryId` \| `community` `communityId` \| `given` `characters[]` \| `adversary`
`adversaries[]` (printed on stat blocks: a feature of those creatures, never a character's) -- then
`text`,
`features[]` (a grimoire's spells), and for a chosen card only `domain`, `type`, `level` and
`recallCost`. What a class, subclass, ancestry or community prints is a card granted by it; nothing
on the class lists them.

An **ability** (`project.abilities[]`): `id`, `name`, `source` (`card` -- the card it sits on, in
play when the card is; a stat block's feature sits on a card granted by `adversary`), `text` (the card's
text when empty), `kind`
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
fires on its own; an interrupt never does). The engine's own cards are the starter pack's
(`src/engine/content/pack/starter-abilities.ts`). A stat block's features come with whatever pack
or project prints them on it -- the starter pack's creatures carry none -- as abilities on cards
granted by `adversary`; a project ability with a pack ability's id replaces it.

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
are abilities on a card granted by `adversary` to the block. The GM plays one a turn and pays what the block says it costs — a Shadow for one that names no
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
directly, and they and `restrained` are the only conditions the engine ships: every other one a card
or a stat block applies comes with the pack that carries it, and a bonus that lasts while it does is a
modifier on it. A condition lends nothing
by itself: a card granted by it (`grant: { kind: 'condition', conditions }`) is in the hands of
whoever bears one of those, character or creature, while it lasts. A file older than format version
4 whose condition lent an ability through `grants` is migrated to such a card.

### Dialogue

A **dialogue**: `id`, `start` (node id), `nodes[]`. A **node**: `id`, `position?` (canvas
x/y), `lines[]` (`speaker?`, `text`), `onEnter[]?` (effects run before the lines show),
`choices[]?`, `goto?` (next node when there are no choices; omitted ends), `kind?`
(`consequence`: never shown - its `onEnter` runs and the conversation goes to `goto`, or ends). A
conversation opened with a creature binds it as the `target` of every effect inside. A **choice**: `text`,
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
Equip), `stackable` (default true), `value?` (what one is worth in the coin shops are paid in; a
merchant pays half, and nothing for an item without one). A **loot table**: `id`, `rolls` (draws; default 1),
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

Placeholder fiction. The party is six, each named for the body they are drawn with, each with a
subclass, two domain cards and one Experience.

| Who | Class | Carries | Their two cards, and what those cards are here to try |
|---|---|---|---|
| **Quim** | Sentinel, Shieldbearer | Longsword, ringmail | Power Slash, Iron Stance - damage and armour, the plain case |
| **Violet** | Cutpurse, Lampsnuffer | Hunting bow, padded coat | Quick Hands, Backstab |
| **Scarlet** | Emberwright, Flamecaller | Ember staff, padded coat | Arcane Ward, Healing Word |
| **Arty** | Cutpurse, Lampsnuffer | Hand cannon, padded coat | **Powder and Shot** loads two shots onto **Grapeshot**, which spends one to hurt everything Very Close and knock it out to Close. A magazine and knockback |
| **Pint** | Emberwright, Flamecaller | Bound ledger, padded coat | **Mark the Page** keeps the place they stand and puts them back on it next time. **Footnote** puts a failed roll's dice back in the cup, and starts in the vault |
| **Ganja** | Sentinel, Shieldbearer | Oaken tankard, ringmail | **Another Round** clears a Stress from every ally Close and hands the GM a Shadow for it. **Barrel Through** shoves what is in Melee out to Very Close |

The last three are there to be played against: each of their cards reaches for a rule the first
three never touch - tokens on a card, knockback, a reroll, a place kept on the floor, and the party
choosing to give the GM Shadow. Footnote sits in the vault rather than the loadout because a card
that answers every failed roll stops every roll in the game to ask; recall it at a rest to try it. Every adversary uses the SRD Acid Burrower's stat block,
standing in for the prototype's homebrew Hollow Husks.

1. **The Hollow Vault** (44×32, and relaid as tiles on the way
   in: grass outside, a dirt road that costs double, flagstone indoors, a wall two blocks high that
   whoever is strong enough jumps onto - Kara is, and the drop inside is a fall - stone walls
   a block high standing along the edges of their tiles, and the dais as blocks with its steps - or, in a fight with the steps a
   move away, a jump). The vault door starts shut
   and in the way: using it is a Finesse 13 roll, a failure leaves it shut, and a door can be
   tried again. East of the door, trigger cells start the husk fight; a chest opens
   on a Finesse check and pays out from the `vault-chest` table (gold, a healing draught, or
   the brass key). West and south of the door are **the woods**: a trail winding down to the
   south-west, a stream running south out of the marsh with a ford where the trail crosses it,
   thickets that cost double to push through, hillocks, and an outcrop two blocks high to climb or
   jump off. East of the vault door the halls run on through two cross-walls to a dais between its
   braziers. The room the prototype drew is still the map's north-west corner, tile for tile, so
   the door is still at (12, 7) and a save from before still finds it.
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
- **A card or a stat block's feature with no script is text**: shown and read, and the table
  decides. Of the starter pack's 39 cards, 20 are text -- one a character chooses, and nineteen
  features a class, subclass, ancestry or community prints; an
  imported pack's cards are as scripted as the pack made them, and an adversary plays the features it can run and otherwise falls back on its
  standard attack. A card is text when it asks for something the engine has no number for, such as
  flight, teleportation or a GM's discretion.
- **A temporary condition on a party member ends when their turn does** — "until they next
  act", read as the moment the party hands the spotlight back. It is how a hold the SRD ends
  with a Strength Roll comes off at all, since nothing here can ask for that roll.
- **Adversaries clear a temporary condition only when Restrained** (or with nothing in reach).
  The SRD lets a creature roll or spend to clear one; here an adversary spends its spotlight,
  and a party member's ends when their turn does.
- **Quests have no stages**: steps can be hidden and revealed, but the summary is one string
  and is never rewritten.
- **Domain-card and subclass features without a script are text**, shown in the hand and on
  the level-up sheet but not executed.
- **No items or loot-table UI**, no sheet editor, no tint tool though `tints` is document
  data.
- **Construction navigation**: building tiles have visual LOD but do not yet affect walking,
  collision or line of sight. The tactical ground remains a single height field.
- **Editor camera**: right-drag pan, middle-drag orbit, wheel zoom, WASD/arrows, Q/E and Home work in
  edit mode; **F** (frame the selected character) is still play-only.
- No entity-hover links in the log.
- An impossible attack click is silent.
- A scripted check (an object, a conversation) awards Light to whoever used the thing and Shadow
  to the GM, the same as an attack; an object's check rolls with the party's best trait.
- Travel rebuilds the whole scene view; fine for two rooms, not measured for fifty.
- `story` renders as a single log line; its `button` field is ignored.
- Project format is `formatVersion` 4; an older file is migrated as it is read, and a newer one is
  refused. CONTEXT.md mentions zip
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
  Left hold    walk towards the pointer       drag with tool (erase, raise/lower)
  Middle drag  orbit                          orbit
  Right drag   pan                            pan
  Right click  inspect (Escape closes)        —
  Wheel        zoom                           zoom (Ctrl: build level)
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
The hand:    Attack · one card per action or reaction (hover to read; cost on its corner, or why not
             along its foot) · passives as emblems above · Light orb · End Turn
             Rest… (out of combat) · Loadout… (recall costs Stress outside a rest)
Roll prompt: Utilize an Experience (1 Light) · Roll · Step back
```
