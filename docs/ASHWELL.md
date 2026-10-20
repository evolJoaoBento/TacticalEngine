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

## Level 1 — The Throat (built)

The old well shaft and the flooded cistern under the town, built as three scenes - the Throat, the Kennel and the
Sump - since a fight is everyone hostile in the scene it is in, and the level has three. Passages join them by stairs
paired across the scenes, so the party comes up where it went down. **Faction:** the **Wellrats**, townsfolk who went down for
the dead's belongings and stayed, stripping whoever falls. **Boss:** **the Cistern Warden**, once the town's
well-keeper, now the Wellrats' chief, armoured in rusted well-chain.

- **The Shaft Foot** — where the rope ends, on a heap of what fell before. Vane's first page is nailed to the wall.
- **The Long Gallery** — a channel of black water, waist-deep in the middle, shallow at the edges. Slow going.
- **The Wellrat Camp** — a fire, stolen goods, and the Wellrats who keep it: cutters and a slinger.
- **The Kennel** — where the Wellrats keep what they feed the dead to: rot-hounds, and something that waits in the
  wet. A chest of what the hounds did not eat.
- **The Sump** — the cistern's deepest chamber, where the Warden holds court with grave-moths in the lamp smoke.
  His strongbox holds the key to the Sump Gate.
- **The Sump Gate** — an iron grate over the stair down, locked with the Warden's key.
- **The stair down** — to the Ossuary Market. For now it ends at bone, and the party climbs back with what they
  learned.

**Vane's page:** *"They came down in good order. They checked the rope twice. The tall one was afraid of the water
and did not say so. Entry 4,112."*

## Level 2 — The Ossuary Market (built)

Three scenes: the Market, where nobody fights; the Charnel Pit, down a passage east; and the Counting House, behind
the Guild's door. The Sump's stair comes down into the Market the first time with Vane's page (the end of Level 1),
and every time after without it; the Market's bone stair climbs back to the Sump.

- **The Market** — stalls of stacked bone; **Factor Osk Dunmere**, who sells potions and gear and buys at two-fifths;
  **Usher Grale** at the Guild's door, who sets the errand; Vane's page pinned to a stall with a finger bone.
- **The Charnel Pit** — three Pit Ghouls (a stat block of the adventure's own, tier 2) and the Bone-Rats. The bell-rope
  cannot be cut while they stand; cut, Grale marks the party, and the Guild's door opens to the mark.
- **The Counting House** — **Sela Marrow, the Bone-Broker**, her two Bonecutters and her Tallyman, all talking, none
  fighting. Her price for the Bone Door's key is a name: **Mother Ketch's** (and Ketch, back at the Lantern, cannot
  remember her own); **one of the party's** (two Stress each, and none of them can say whose); or **Hob Annick's**,
  a Presence 14 roll - the dead are cheap, and a failed roll insults her. **Refuse**, and she and all of hers turn at
  once; her ledger-box gives the key over their bodies.
- **The wet stair** — past the Bone Door, down into the flooded Library; for now Vane's page sends the party back up,
  a level higher, and Ketch has something to say about the Guild.

The design, as it was set down:

A market cut into an old charnel pit, where the **Quiet Guild** trades in bones, teeth and names: who died, where,
and what they carried. They are polite, and they buy everything. **Threat:** ghouls that come up through the floor
when the market bell rings. **Boss:** the **Bone-Broker Sela Marrow**, who will sell the party the way down for a
price paid in the dead (their own, if they have none to spare). **What the stair costs:** a name given to the Guild.
**Vane's page:** an exact list of what the party will be offered, and what they will choose.

## Level 3 — The Drowned Library (built)

Three scenes: the **Reading Room**, knee-deep, with no fight - **Aud Brennock**, the last of the Kindlers, feeding
pages to a fire on a reading platform, who gives the party her tinder; the **Wet Stacks** and their ink-wraiths (a
stat block of the adventure's own, tier 2), with a drowned reader's satchel that opens once the ink is still; and the
**Index**, where the Undertow Index (a tier-2 solo of its own) guards the catalogue. Once it is down, the catalogue
gives the party its own page - and, with Aud's tinder, may be burnt, every name in it with it. The sealed stair opens
only to that page, read aloud: every one of them marks a Stress, and the way goes on down into the Furnace. Aud
answers differently after, burnt or not.

The design, as it was set down:


Vane's first archive, flooded when the sea came up. Shelves standing in black water; pages that float and
whisper. **Threat:** **ink-wraiths**, the drowned recorded dead, who want to be read aloud. **Rival:** the
**Kindlers**, a band who came down to burn the ledger and are slowly being written into it. **Boss:** **the Undertow
Index**, a catalogue that hunts by name. **What the stair costs:** a page of the ledger, carried and read.
**Vane's page:** the party's own entries, half-written, waiting for an ending.

## Level 4 — The Furnace of Names (built)

Three scenes: the **Ash Nave**, with no fight - the Choir of Ash in rows between the pews, **Precentor Ilse Grey**
conducting, and the Furnace Door too hot to touch; the **Coal Gallery**, its iron Stokers (a tier-2 bruiser of the
adventure's own) and the great valve that cools the door once they are down; and the **Furnace Hall**, where **Oswin
Pell, the Bellows Saint** (a tier-2 solo of its own) works the bellows. Past him, the Name Furnace opens the last stair
for one name: one of the four writes theirs, marks three Stress, and loses one thing they remember, said in the log -
Quim the face of whoever taught them the sword, Violet their childhood house, Scarlet their mother's voice, Arty why
they came down at all. The last stair ends the level with Vane, nervous, waiting behind a plain wooden door; back at
the Lantern, Ketch counts the party twice. Vane's page on the pew tells why the Choir sings, and Ilse, asked, begs the
party not to tell them.

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
