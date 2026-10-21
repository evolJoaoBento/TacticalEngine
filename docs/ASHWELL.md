# The Ashwell — a grim megadungeon in five levels

An adventure of the engine's own: every place, person and beat in it is written for this project. It is built in code
(`src/game/adventures/ashwell.ts`, with what the levels share in `ashwell-kit.ts` and each level in a file of its own,
`ashwell-level1.ts` to `ashwell-level5.ts`) as a project document for whichever party comes - SRD characters, made at
New Game and asked along at the camp, their cards from the SRD character pack the project lists - and begun through
the camp's portal (`src/game/adventure-portal.ts`), which keeps each beginning as a game of its own in the browser.
The Furnace's names are the party's (`hall(party)`); with no party brought, it is written with four of the camp's
company.

**Status:** the hub and all five levels are built and playable, end to end, with three endings. Each was a slice, as
level.

## The premise

Hallowmere was a market town on a salt marsh, until the sea came up through its well. The well was capped with a
millstone and a prayer, and for a generation the town forgot it. This winter the millstone cracked, and the well began
to breathe ash: grey, warm, smelling of pages burnt. People who go down do not come back, and the ones who come back
are worse.

Below the town is the work of **Orsolde Vane, the Sallow Archivist**. He was the town's recorder of births and
deaths, and he found he could not bear that a death goes unrecorded once the last person who remembers it is gone.
So he went down into the dark and began to keep a ledger of everyone who dies below Hallowmere: how they died, what
they were afraid of, what they said at the end. The ledger is his life. He does not want the party dead. He wants
them to die *well*, in ways worth writing, and he arranges the dungeon so that they will.

**Tone:** grim. Nobody below is saved by being good. Rewards are small and cost something. Vane is never cruel for
its own sake; he is an archivist, and that is worse.

**His voice:** Vane speaks through ledger pages pinned where the party will find them, written before they arrive.
Each one describes the party a little too well.

## The hub: the Lantern & Lye

A low tavern built over the well's mouth, which is now a ring of cracked stone in the middle of its floor with a rope
and a winch over it. **Mother Ketch** keeps it. She washes and buries the bodies that come up, sells rope and lamp oil,
and keeps a slate of names by the door: everyone who has gone down. She is not kind, but she is fair, and she will
tell the party exactly how the last ones died.

- She starts the quest **Down the Ashwell** and gives each delve a reason.
- The winch over the well is the way down to Level 1; the same rope is the way back.
- **Her shelf** sells what keeps a party alive below - minor health and stamina potions at ten gold, two healing
  draughts at twenty - and **the hearth** is a night on her floor for five: three Hit Points and two Stress back for
  everyone, or, short of the coin, a line about what she does not keep for free.
- **Her slate** by the door reads back what the party has done: Ketch's own name given at the Throne, Tam's ring
  returned, Annick spared, the ledger burnt.

It is a room with a shape (the second pass): a long counter of planks with shelves behind it, the well's ring in the
middle, tables, the hearth in the corner - lit by the fire and two torches at half the light of day.

## Level 1 — The Throat (built)

The old well shaft and the flooded cistern under the town, built as three scenes - the Throat, the Kennel and the
Sump - since a fight is everyone hostile in the scene it is in, and the level has three. Passages join them by stairs
paired across the scenes, so the party comes up where it went down. **Faction:** the **Wellrats**, townsfolk who went down for
the dead's belongings and stayed, stripping whoever falls. **Boss:** **the Cistern Warden**, once the town's
well-keeper, now the Wellrats' chief, armoured in rusted well-chain.

- **The Shaft Foot** — where the rope ends, on a raised heap of what fell before, a stair down off it. Vane's first page
  is nailed to the wall, and it says Annick hid the proof of who he was at the shaft's foot: **a loose stone** there
  is an Instinct roll (12), once - behind it, his **keeper's token**, or only wet stone.
- **The Long Gallery** — a channel of black water across the cistern, a ledge of stone along one side broken in the
  middle. Slow going, in sight of the camp.
- **The Wellrat Camp** — a fire on a raised platform, stolen goods, and the Wellrats who keep it: cutters, a slinger,
  and **Nails**, who keeps their count. Wounded past three fifths she drops her blade and talks: about Annick, what he
  was, and what might make him remember.
- **The Kennel** — where the Wellrats keep what they feed the dead to: rot-hounds, and something that waits in the
  wet, in the darkest room of the level. A chest of what the hounds did not eat, and in it **Tam Ketch's ring** -
  Ketch's husband, who went down the first winter. Brought back to her, she gives a healing draught, and the slate
  remembers.
- **The Sump** — the cistern's deepest chamber: a platform of stacked doors in the deep water, causeways of boards to
  it, and the Warden on it with **lamp moths** (minions) in the smoke. **The Warden** is Relentless (2) and lashes with
  **Drag Under**, his own card: a Close attack that Restrains. At half his blood he kneels: shown his token, or told
  by Nails what he was, he remembers the keeping, gives the key and is spared (`annick-spared`); otherwise he dies on
  his doors and his strongbox holds the key.
- **The Sump Gate** — an iron grate over the stair down, locked with the Warden's key.
- **The stair down** — to the Ossuary Market. For now it ends at bone, and the party climbs back with what they
  learned.

**Vane's page:** *"They came down in good order. They checked the rope twice. The tall one was afraid of the water
and did not say so. Entry 4,112."* Entry 4,113, past the gate, knows whether Annick gave the key or had it taken.

## Level 2 — The Ossuary Market (built)

Three scenes: the Market, where nobody fights; the Charnel Pit, down a passage east; and the Counting House, behind
the Guild's door. The Sump's stair comes down into the Market the first time with Vane's page (the end of Level 1),
and every time after without it; the Market's bone stair climbs back to the Sump.

- **The Market** — aisles of plank stalls under walls of stacked bone, lit by lamps of yellow fat; the **market bell** in
  a frame of thighbones over the pit's mouth in the middle; **Factor Osk Dunmere** up on his dais, who sells potions
  and gear and buys at two-fifths; **Clerk Wenna**, who buys keepsakes - Tam Ketch's ring for thirty, Annick's token
  for eight - and sells them back up to Hallowmere on market day (sold, the ring is on Ketch's thumb, bought back, and
  her slate says so); **Usher Grale** at the Guild's door, who sets the errand; Vane's page pinned to a stall.
- **The Charnel Pit** — bone drifts up the walls, black water in the middle, and on a raised ledge in the far corner
  **Sexton Mott** on the bell-rope, with two Pit Ghouls (tier 2, who **Feed**: a bite that heals them) and the Bone-Rats.
  At the party's first roll Mott rings the bell: **a looping countdown (4)** that every action roll swings, and every
  time it comes round two **Risen Corpses** (minions) climb out of the heaps by the ledge. It stops when Mott falls -
  or, at half his blood, when he lets go and says who pays him: Grale, a tooth a ringing, for the bone meal. Either
  way the rope gives up the Usher's chit, and cut, Grale marks the party, and the Guild's door opens to the mark.
- **The Counting House** — a dais behind a desk of jawbones, shelves of ledgers to the ceiling. **Sela Marrow, the
  Bone-Broker** (Momentum, and **Call in the Debt**: two of hers spotlighted), her two Bonecutters and her Tallyman,
  all talking, none fighting. Her price for the Bone Door's key is a name: **Mother Ketch's** (and Ketch, back at the
  Lantern, cannot remember her own); **one of the party's** (two Stress each, and none of them can say whose); **Hob
  Annick's** - a Presence 14 roll while he is dead, the dead being cheap, and a failed roll insults her; nothing at all
  if the party spared him, since a living name is a real price; or, to those who know about the bell and did not take
  Grale's purse for quiet, **Usher Grale's** - the third way Vane's page promised. **Refuse**, and she and all of hers
  turn at once; her ledger-box gives the key over their bodies.
- **The wet stair** — past the Bone Door, down into the flooded Library. Vane's page there says what the key cost:
  whose name went into the ledger, or that the party took it by force.

The design, as it was set down:

A market cut into an old charnel pit, where the **Quiet Guild** trades in bones, teeth and names: who died, where,
and what they carried. They are polite, and they buy everything. **Threat:** ghouls that come up through the floor
when the market bell rings. **Boss:** the **Bone-Broker Sela Marrow**, who will sell the party the way down for a
price paid in the dead (their own, if they have none to spare). **What the stair costs:** a name given to the Guild.
**Vane's page:** an exact list of what the party will be offered, and what they will choose.

## Level 3 — The Drowned Library (built)

Three scenes:

- **The Reading Room** — knee-deep black water between shelves, no fight. **Aud Brennock**, the last of the Kindlers,
  feeds pages to a fire on a reading platform raised out of the water, and gives the party her tinder; told the Broker
  has one of their names, she says where it went (the Index files whatever is given up, and a name read back by its
  own people is theirs again). A **drifting page** hides a Kindler's note on the Index behind a Knowledge 13 roll -
  keep out of its lamps, and it reads slower; a failed roll reads your own name instead, and marks a Stress.
- **The Wet Stacks** — rows of shelves standing in the water, a dry walk down the middle, and a ledge with a drowned
  reader's satchel that opens once the ink is still. The **ink-wraiths** (tier 2, of the adventure's own) **Pull
  Under**: a Very Close attack that Restrains. Once they are down the **Kindlers' shelf** can be read, against Aud's
  advice, for a Stress: the six the Index filed, and Aud's own card, not finished - "She will burn until the Index
  does, and then she will stop." Told, Aud says it is the kindest thing he ever wrote.
- **The Index** — a moat, and on an island up a short stair the catalogue, a cabinet of drawers taller than the walls.
  The **Undertow Index** (a tier-2 solo of its own) **Reads You Aloud**: at the party's first roll, a looping countdown
  (3) that every action roll turns; each time round it reads the next line of the party's own entry - what they did
  to Annick, then the name they paid the Broker, then how they die - and every one of them rolls Instinct 14 or marks
  a Stress. It reads a step faster with a name of theirs already filed (`gave-our-own`), a step slower for those who
  read the drifting page. Once it is down the catalogue gives the party its own page; with it, the name they gave the
  Broker, read back, two Stress each cleared; Annick's card, warm if he was spared, which those who sold it may tear
  out; and Aud's line, if they read it. Then, with Aud's tinder, it may be burnt, every name in it with it.
- **The sealed stair** opens only to that page, read aloud: every one of them marks a Stress, the page says what they
  did in the Library (the name found, Annick's card, the Index burnt), and the way goes on down into the Furnace. Aud
  answers differently after, burnt or not.

The design, as it was set down:


Vane's first archive, flooded when the sea came up. Shelves standing in black water; pages that float and
whisper. **Threat:** **ink-wraiths**, the drowned recorded dead, who want to be read aloud. **Rival:** the
**Kindlers**, a band who came down to burn the ledger and are slowly being written into it. **Boss:** **the Undertow
Index**, a catalogue that hunts by name. **What the stair costs:** a page of the ledger, carried and read.
**Vane's page:** the party's own entries, half-written, waiting for an ending.

## Level 4 — The Furnace of Names (built)

Three scenes:

- **The Ash Nave** — no fight. The Choir of Ash in rows between the pews, **Precentor Ilse Grey** conducting, and the
  Furnace Door at the end, red at the hinges: trying it before the valve is turned costs a Stress. Each chorister
  answers when spoken to - singing on, eyes shut, or, once told, sitting silent. Vane's page on the pew tells why the
  Choir sings (the Saint does not burn the ones who are singing, and draws on their song), and Ilse, asked, begs the
  party not to tell them: **say nothing**, or **tell them** - the song stops, and the Saint has nothing to draw on.
  Once the Saint is past (his fight won, and the furnace reached), Ilse **sends the Choir up the well** (telling them herself, if the party kept her
  secret), and Ketch's slate, at the Lantern, chalks them in.
- **The Coal Gallery** — low and black: coal chutes in the north corners, heaps of coal, and the great valve on a
  platform at the far end. The iron **Stokers** (tier 2, of the adventure's own) shovel a creature **Into the Chute**
  (knocked back to Close). Once they are down the valve is **a test of strength** (Strength 13), tried until it turns:
  with Shadow it turns and blisters the hands on it (a Stress); a failure costs a Stress, or with Shadow a burn off the
  chain (1d6).
- **The Furnace Hall** — the furnace fills the east wall, floor to well above a man, a mouth of white light.
  **Oswin Pell, the Bellows Saint** (a tier-2 solo of its own) has **The Bellows**: at the party's first roll the
  furnace breathes out over the floor round him, ground that burns whoever comes into it (1d6) until he falls; and
  **The Hymn**: hurt, he heals by the Choir's song coming through the doors, three times - unless they were told.
  Past him the Name Furnace opens the last stair for one name: one of the four writes theirs, marks three Stress, and
  loses one thing they remember, said in the log - Quim the face of whoever taught them the sword, Violet their
  childhood house, Scarlet their mother's voice, Arty why they came down at all.
- **The last stair** ends the level with Vane, nervous, waiting behind a plain wooden door; his page there says whose
  name it was and what went with it (he has kept the page, on his desk), and whether the Choir went up. Back at the
  Lantern, Ketch counts the party twice.

The design, as it was set down:


Where names are smelted: Vane burns the pages of the finished dead to fuel the lamps that light his halls, and the
ash is what the well breathes. **Faction:** the **Choir of Ash**, the faithful who sing in the smoke and want to be
burnt into the light. **Threat:** iron constructs that stoke the fires. **Boss:** **the Bellows Saint**. **What the
stair costs:** a party member's name, burnt, and with it something they remember.

## Level 5 — The Ledger Throne (built)

One scene. **Orsolde Vane** writes at his lectern inside a ring of reading screens, and the Written - three of his
drowned and burnt, ink-wraiths - stand among the shelves; all of them on nobody's side, and Vane talks for all of them.
He answers for what the party did on the way down: Ketch's name, if it was sold, and the Index, if it was burnt. Three
endings, each the Ashwell's end (`ashwell-ended`), each written up and sending the party back to the Lantern, where
Ketch has a word for it:

- **The pen** (`ending-took-the-pen`): he gives it up, gladly; the party keeps the ledger now, taking it in turns, and
  Ketch leaves the lamp lit by the rope.
- **Leaving him to it** (`ending-left-him`): the ash keeps coming up the well; Ketch keeps her slate.
- **The ledger burnt** (`ending-burned`): the only way to a fight. Vane refuses, the Written stand up, and once they
  are down the ledger burns. The well stops breathing ash, Ketch's slate is clean and she does not know what it was
  for - and if it was her name the Broker took, she has it back.

Vane is a tier-3 solo of the adventure's own (the Sallow Archivist).

The design, as it was set down:


A quiet room, warm and lamplit, and the ledger on its lectern, eleven thousand entries long. **Orsolde Vane** waits,
with the pen. He is old and small, and he will not fight unless the party makes him. **The choice:** destroy the
ledger (and every name in it is forgotten — Ketch's slate goes blank), take the pen (and keep the ledger), or leave
him to it and climb out. **The fight, if it comes:** Vane writes the room around him, and every entry he finishes is
a wound.

## The second pass (begun 20 October 2026)

The first pass built every level, end to end; an audit of it (20 October 2026) found the story strong and the play thin.
Every room was flat and lit like an afternoon; seven of the eight fight rooms were one template, 16 wide, the fight
waking one step past the door; the adventure's own eight stat blocks had no features; there was one roll in the whole
of it (Sela's Presence 14); no trap, no secret, one optional room; the set pieces the intros promise - the platform of
stacked doors, the reading platform, the cabinet taller than a house, the furnace that fills a wall - were a banner, a
pillar and a camp fire; and five flags were set that nothing read (`read-vanes-page`, `gave-our-own`,
`gave-annicks-name`, `burnt-<id>`, Ilse's *why*).

The second pass rebuilds it a slice at a time, each judged on all three: **how it looks**, **what the level is about to
play**, and **what the story pays back**. Ids, dialogue options and the props the spec drives are kept; what is new is
added.

1. **Lit rooms, and the kit** (done, 21 October 2026). An engine change of its own: a scene says how much light it has, and the torches, braziers
   and fires in a dim one light it. Then the kit grows what a dungeon is made of - floors raised and sunk, a stair up to
   them, water below the floor, structures of the adventure's own (shelves, pews, lecterns, a platform of doors, a
   furnace) drawn in textures of their own - and **Level 1 and the Lantern** are rebuilt on it: an approach to the
   Wellrats across the water, a ledge that may give, the Warden on his platform of doors with features of his own and
   a parley at half his blood, the Kennel worth the detour; Ketch sells rope and oil and the Lantern is a place to rest.
   *As built:* the kit's legend gained `^` raised floor, `B` a deck of planks, `/` a stair (turned toward whichever
   neighbour is raised), `=` boards, and a room's own furniture by character (`Furniture`: counter, shelf, pew,
   furnace, slab - a block or a rail, stretched to a height, in a texture of its own). The ledge that may give became
   the loose stone at the shaft's foot, which pays Vane's page; `read-vanes-page` is still read by nothing (the Throne's
   slice).
2. **The Ossuary Market** (done, 21 October 2026). The bell as a countdown - ghouls up through the floor until the rope is cut; the stalls a
   market with a shape; Sela's price remembered below (who was named, and what it cost).
   *As built:* the countdown is the Sexton's, a reaction to the party's first roll (a feature the GM would have to
   spotlight him and pay a Shadow for came too late, or never); the dead it calls are minions, and the way to stop it is
   to reach the ledge. Grale is the bell's paymaster, and his name the third way. `gave-our-own` and
   `gave-annicks-name` are read by Vane's page below; what the Library does with them is slice 3's.
3. **The Drowned Library** (done, 21 October 2026). Shelves as shelves, the reading platform raised out of the water, the Index hunting by name
   (a countdown that reads the party's own entries); pages to read for what they hide.
   *As built:* the Index's countdown is the Sexton's shape again - a reaction to the first roll, costing nothing - and
   reads the entry a line further each time round (`index-read`, a variable), every one of the party rolling not to
   flinch. The cabinet is a `Furniture` kind of its own, `drawers`, three blocks high. `gave-our-own`,
   `gave-annicks-name` and `annick-named-living` are read in the catalogue, and the flags the Library sets
   (`knows-the-index`, `read-auds-entry`, `found-our-own`, `freed-annicks-name`) are read in it too - by the Index, Aud,
   the catalogue and the sealed stair's page.
4. **The Furnace of Names** (done, 21 October 2026). Heat as a hazard, the Choir as bystanders with a will, the valve as a test of strength,
   the furnace filling its wall; the name burnt read back to the party at the bottom.
   *As built:* the heat is the Furnace Door's Stress, the valve's burns, and the Saint's Bellows - a zone (`zone` with a
   condition of the adventure's own, `furnace-breath`, whose `onEnter` burns) laid round him at the party's first
   roll. The Choir's will is Ilse's choice made the party's: telling them silences the Hymn (a `tookHitPoints`
   reaction), and once the Saint is past they go up the well (`remove` on each chorister). `burnt-<id>` and
   Ilse's *why* are read now - by the page at the foot of the stair, the Hymn and Ilse - and `choir-led-up` by that
   page and Ketch's slate. The page says the burnt page is on Vane's desk; what he does with it is slice 5's.
5. **The Ledger Throne.** A room worth ending in; Vane's fight writing the room around him; the Pen reachable by what
   the party did, not only by what it says; every flag paid.

## Building it, level by level

Each level is a slice: its scene, its encounters, its loot, its page from Vane, and the stair down; a test that the
project is whole (`ashwell.test.ts`) and a play through it in the browser (`tests/e2e/ashwell.spec.ts`).

- **Materials:** each level is drawn in Poly Haven textures (CC0), its own wall and its own floor
  (`ashwell-kit.ts`, `LOOKS`): plastered stone and worn wood at the Lantern and at the Throne, castle brick and
  cobblestone in the Throat, stone brick and sandstone blocks in the Market, rock wall and marble in the Library, rustic
  stone and a dirt floor in the Furnace - ten textures, every one a starter checked against Poly Haven, each repeating
  at the size of the patch it shows. They are **linked, not carried**: the project names each texture, and the page
  fetches, packs and compresses it the first time a room needs it and keeps it in the browser after. So the project
  is a few hundred kilobytes, which the browser's saves can hold when the Ashwell is begun; a level's first visit on a
  device shows its rooms in plain stone for a few seconds while its two textures are prepared - a note at the top of
  the page says so, and how far each has got - and never again on that device. Rubble and the low walls are the demo's own models; the black water and the bedrock are plain colour.
- **Adversaries** come from the engine's starter blocks, renamed for the place; a boss is a stat block of the
  adventure's own (`project.adversaries`).
