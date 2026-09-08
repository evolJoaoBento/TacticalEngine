# Adversary features: what the engine runs

Every feature printed on an adversary in the vendored stat blocks, and what this engine
does with it. Three states:

- **read** — a rule the fight obeys, read straight off the block
  (`src/engine/combat/adversary-features.ts`): Relentless, Horde, Minion, Momentum, Terrifying.
- **scripted** — an ability in the one effect vocabulary
  (`src/engine/content/srd/adversary-abilities.ts`), used by the GM on its spotlight.
- **text** — printed for the GM to narrate; the engine does nothing with it.

Why a feature is text, in the order the reasons come up. It asks for something the
engine has no place to put:

- **a summon the block does not name** — "1d4+1 Tier 1 adversaries", "six Tier 3
  Minions", "Minions relevant to a personal nightmare": which stat block arrives is the
  GM to pick, and an engine that picked one would be writing the encounter. The ones
  that name what they call are scripted.
- **a countdown whose trigger or payoff the vocabulary cannot say** - the clock itself
  runs (`src/engine/rules/countdown.ts`), so the ones that arm on a spotlight, tick on a
  roll and then damage, summon or apply a condition are scripted. What stays text is the
  payoff: a charge in a straight line through everyone, a circle of ground that stays
  dangerous, allies made to attack, a clock somebody else winds. Two are the other way
  round - the Flickerflies say what they do plainly enough, but "takes damage for the
  first time" is not a trigger anything raises: the defence step answers damage with
  shapes, not with a script.
- **a spotlight nothing can aim** - a Leader handing the GM turn to its own side runs
  (a `spotlight` effect, paid for by the feature that said so), so what stays text is the
  aiming: allies chosen by what they could reach without moving,
  a creature the block counts as one of its own, an extra spotlight for the one acting.
- **a point on the map** — "choose a point within Far range; everyone within Close range
  of *that*": selectors read bands around the creature that is acting, not around a spot.
- **a rule about a third creature** - "disadvantage on attacks against targets other
  than the Swarm", "attacks against a creature this one stands beside have advantage". A
  passive can move the dice for its holder or against them (`advantage`, with `against`)
  and that is two parties; a third is not something a modifier can name.
- **a token nobody else can count** - tokens run, on a stat block as well as on a card.
  The store is keyed by creature and card, so a passive keeps a count on itself (Slow
  is one `spotlighted` reaction branching on its own tokens, placing one on the turn it
  gathers and spending it on the turn it acts, with `endSpotlight` paying for the wait)
  or hangs one on somebody else (the Swarm's brambles, which Restrain whoever carries
  them and come off when the Swarm takes Major damage). What stays text is the asking:
  a roll a PC makes on their own turn to tear free, an action aimed at whoever is
  carrying three of them - the GM takes the nearest creature in reach, not the one a
  feature would rather have - and ground that stays dangerous after the feature ends.
- **a path rather than a destination** - a creature crossing the ground runs (`move`,
  towards somebody or away from them, as far as the band it names allows), so what
  stays text is the line it draws on the way: "move to a point within Close range and
  deal damage to all targets in their path". A destination and a band around it is
  scripted - the Dive-Bomb lands and hits everyone within Very Close of where it landed.
  So is a walk on the way in or out of a swing; what is not is an interrupt before the
  roll ("when a creature moves into Melee range to make an attack"), and the passives
  about flight, stone and shadows, which are about where a creature may go rather than
  about it going there.
- **a number the blow does not carry** - how much of a wound landed is now read: an
  amount can be written as a count (`hitPointsTaken`, `hitPointsDealt`, `targetsHit`)
  and a feature can be gated on one, which is what "when the Brawler marks 2 or more
  HP" was waiting for. Damage sent back is `dice: 'same'`, which keeps the blow's own
  dice and type. What stays text is every other number: one the block keeps rather than
  the blow (handfuls of gold, the Assassin's unmarked Stress), one spent per target
  rather than in total ("lose a number of Hope equal to the HP they marked"), dice
  rolled one per Hit Point, and a Fear cost that is a number rather than a price - the
  vocabulary gains Fear and never spends it.
- **a condition the SRD prints once** — Entranced, Poisoned, Cursed, Deathlock and the
  rest: written into that one block rather than into the rules.
- **a social beat** — a bargain, a rumour, a scapegoat: a scene rather than a grid.
- **an offer to the player** - "they can choose to reroll their Fear Die". What the room
  makes of a roll the party made now runs (`partyRolled`, with a `rolled` gate reading
  what the dice said and the one who rolled bound as the target), so what stays here is
  a feature that hands the player a decision, and a roll made in conversation.
- **a swap whose condition nothing can ask** - a passive can change what the block's own
  teeth do to this target ("1d10+4 instead of their standard damage" while Hidden,
  "double damage to PCs with 0 Hope"), read from the attacker's chair with the target
  bound. What stays text is the asking: standing above somebody, a roll that had
  advantage, and a third creature beside the target ("another Wolf within Melee range
  of the target").
  A rider on *being* attacked now runs - a swing raises `attacked` on whoever it was
  aimed at, hit or miss, and the Swashbucklers gate on how little the blow marked.
- **an ally on the other side** — the GM's turn aims a feature at the party, so a
  feature that shields or heals one of its own has no way to be pointed at it.

Facing is *not* a reason: "in front of the Burrower" is read as the whole band, as Spit
Acid has been from the start. Nor is a summons that names its block: "summon three
Jagged Knife Lackeys, who appear at Far range" is a `summon` effect, and they are in
the fight from the moment they are standing there. Nor is a swarm: "spotlight all
Giant Rats within Close range of them" is a `joinedBy` on the attack the feature
makes, and the rest of the kind walk in and swing with it. Nor is resistance — a passive that halves or ignores a
damage type is a `defenses` line, and so is one that takes a number off the total
before the thresholds are read ("reduce it by 3", "reduce it by 1d10"). Neither is a
rider that follows the swing the block already prints, which is a reaction to
`dealtHit` or `dealtDamage`.

A scripted feature says as much of its text as the vocabulary carries; where it says
less, the entry in `adversary-abilities.ts` carries a line saying what was left out.
The text shown at the table is the block's own, printed as written, so when a script
departs from it rather than merely doing less, what the engine actually does is in the
condition it applies: the Oak Treant's Rooted halves physical damage and does not hold
it still, because a creature this engine holds still spends its next turn tearing free.

Read: 73. Scripted: 180. Text: 164.

| Adversary | Feature | Kind | Engine |
|---|---|---|---|
| Acid Burrower | Relentless (3) | Passive | **read** — read off the stat block |
| Acid Burrower | Earth Eruption | Action | **scripted** — runs as an ability |
| Acid Burrower | Spit Acid | Action | **scripted** — runs as an ability |
| Acid Burrower | Acid Bath | Reaction | **scripted** — runs as an ability |
| Bear | Overwhelming Force | Passive | **scripted** — runs as an ability |
| Bear | Bite | Action | **scripted** — runs as an ability |
| Bear | Momentum | Reaction | **read** — read off the stat block |
| Cave Ogre | Ramp Up | Passive | **text** — the GM's to play |
| Cave Ogre | Bone Breaker | Passive | **scripted** — runs as an ability |
| Cave Ogre | Hail of Boulders | Action | **scripted** — runs as an ability |
| Cave Ogre | Rampaging Fury | Reaction | **text** — the GM's to play |
| Construct | Relentless (2) | Passive | **read** — read off the stat block |
| Construct | Weak Structure | Passive | **text** — the GM's to play |
| Construct | Trample | Action | **text** — the GM's to play |
| Construct | Overload | Reaction | **text** — the GM's to play |
| Construct | Death Quake | Reaction | **text** — the GM's to play |
| Courtier | Mockery | Action | **scripted** — runs as an ability |
| Courtier | Scapegoat | Action | **text** — the GM's to play |
| Deeproot Defender | Ground Slam | Action | **scripted** — runs as an ability |
| Deeproot Defender | Grab and Drag | Action | **text** — the GM's to play |
| Dire Wolf | Pack Tactics | Passive | **text** — the GM's to play |
| Dire Wolf | Hobbling Strike | Action | **scripted** — runs as an ability |
| Giant Mosquitoes | Horde (1d4+1) | Passive | **read** — read off the stat block |
| Giant Mosquitoes | Flying | Passive | **scripted** — runs as an ability |
| Giant Mosquitoes | Bloodsucker | Reaction | **text** — the GM's to play |
| Giant Rat | Minion (3) | Passive | **read** — read off the stat block |
| Giant Rat | Group Attack | Action | **scripted** — runs as an ability |
| Giant Scorpion | Double Strike | Action | **text** — the GM's to play |
| Giant Scorpion | Venomous Stinger | Action | **text** — the GM's to play |
| Giant Scorpion | Momentum | Reaction | **read** — read off the stat block |
| Glass Snake | Armor-Shredding Shards | Passive | **text** — the GM's to play |
| Glass Snake | Spinning Serpent | Action | **scripted** — runs as an ability |
| Glass Snake | Spitter | Action | **text** — the GM's to play |
| Harrier | Maintain Distance | Passive | **scripted** — runs as an ability |
| Harrier | Fall Back | Reaction | **text** — the GM's to play |
| Archer Guard | Hobbling Shot | Action | **scripted** — runs as an ability |
| Bladed Guard | Shield Wall | Passive | **text** — the GM's to play |
| Bladed Guard | Detain | Action | **scripted** — runs as an ability |
| Head Guard | Rally Guards | Action | **scripted** — runs as an ability |
| Head Guard | On My Signal | Reaction: Countdown (5) | **text** — the GM's to play |
| Head Guard | Momentum | Reaction | **read** — read off the stat block |
| Jagged Knife Bandit | Climber | Passive | **text** — the GM's to play |
| Jagged Knife Bandit | From Above | Passive | **text** — the GM's to play |
| Jagged Knife Hexer | Curse | Action | **text** — the GM's to play |
| Jagged Knife Hexer | Chaotic Flux | Action | **text** — the GM's to play |
| Jagged Knife Kneebreaker | I've Got 'Em | Passive | **text** — the GM's to play |
| Jagged Knife Kneebreaker | Hold Them Down | Action | **text** — the GM's to play |
| Jagged Knife Lackey | Minion (3) | Passive | **read** — read off the stat block |
| Jagged Knife Lackey | Group Attack | Action | **scripted** — runs as an ability |
| Jagged Knife Lieutenant | Tactician | Action | **scripted** — runs as an ability |
| Jagged Knife Lieutenant | More Where That Came From | Action | **scripted** — runs as an ability |
| Jagged Knife Lieutenant | Coup de Grace | Action | **text** — the GM's to play |
| Jagged Knife Lieutenant | Momentum | Reaction | **read** — read off the stat block |
| Jagged Knife Shadow | Backstab | Passive | **text** — the GM's to play |
| Jagged Knife Shadow | Cloaked | Action | **text** — the GM's to play |
| Jagged Knife Sniper | Unseen Strike | Passive | **scripted** — runs as an ability |
| Merchant | Preferential Treatment | Passive | **text** — the GM's to play |
| Merchant | The Runaround | Passive | **text** — the GM's to play |
| Minor Chaos Elemental | Arcane Form | Passive | **scripted** — runs as an ability |
| Minor Chaos Elemental | Sickening Flux | Action | **scripted** — runs as an ability |
| Minor Chaos Elemental | Remake Reality | Action | **scripted** — runs as an ability |
| Minor Chaos Elemental | Magical reflection | Reaction | **scripted** — runs as an ability |
| Minor Chaos Elemental | Momentum | Reaction | **read** — read off the stat block |
| Minor Fire Elemental | Relentless (2) | Passive | **read** — read off the stat block |
| Minor Fire Elemental | Scorched Earth | Action | **scripted** — runs as an ability |
| Minor Fire Elemental | Explosion | Action | **scripted** — runs as an ability |
| Minor Fire Elemental | Consume Kindling | Reaction | **text** — the GM's to play |
| Minor Fire Elemental | Momentum | Reaction | **read** — read off the stat block |
| Minor Demon | Relentless (2) | Passive | **read** — read off the stat block |
| Minor Demon | All Must Fall | Passive | **scripted** — runs as an ability |
| Minor Demon | Hellfire | Action | **scripted** — runs as an ability |
| Minor Demon | Reaper | Reaction | **text** — the GM's to play |
| Minor Demon | Momentum | Reaction | **read** — read off the stat block |
| Minor Treant | Minion (5) | Passive | **read** — read off the stat block |
| Minor Treant | Group Attack | Action | **scripted** — runs as an ability |
| Green Ooze | Slow | Passive | **scripted** — runs as an ability |
| Green Ooze | Acidic Form | Passive | **scripted** — runs as an ability |
| Green Ooze | Envelop | Action | **text** — the GM's to play |
| Green Ooze | Split | Reaction | **scripted** — runs as an ability |
| Tiny Green Ooze | Acidic Form | Passive | **scripted** — runs as an ability |
| Red Ooze | Creeping Fire | Passive | **text** — the GM's to play |
| Red Ooze | Ignite | Action | **text** — the GM's to play |
| Red Ooze | Split | Reaction | **scripted** — runs as an ability |
| Tiny Red Ooze | Burning | Reaction | **text** — the GM's to play |
| Petty Noble | My Land, My Rules | Passive | **text** — the GM's to play |
| Petty Noble | Guards, Seize Them! | Action | **scripted** — runs as an ability |
| Petty Noble | Exile | Action | **text** — the GM's to play |
| Pirate Captain | Swashbuckler | Passive | **scripted** — runs as an ability |
| Pirate Captain | Reinforcements | Action | **scripted** — runs as an ability |
| Pirate Captain | No Quarter | Action | **text** — the GM's to play |
| Pirate Captain | Momentum | Reaction | **read** — read off the stat block |
| Pirate Raiders | Horde (1d4+1) | Passive | **read** — read off the stat block |
| Pirate Raiders | Swashbuckler | Passive | **scripted** — runs as an ability |
| Pirate Tough | Swashbuckler | Passive | **scripted** — runs as an ability |
| Pirate Tough | Clear the Decks | Action | **scripted** — runs as an ability |
| Sellsword | Minion (4) | Passive | **read** — read off the stat block |
| Sellsword | Group Attack | Action | **scripted** — runs as an ability |
| Skeleton Archer | Opportunist | Passive | **text** — the GM's to play |
| Skeleton Archer | Deadly Shot | Action | **text** — the GM's to play |
| Skeleton Dredge | Minion (4) | Passive | **read** — read off the stat block |
| Skeleton Dredge | Group Attack | Action | **scripted** — runs as an ability |
| Skeleton Knight | Terrifying | Passive | **read** — read off the stat block |
| Skeleton Knight | Cut to the Bone | Action | **scripted** — runs as an ability |
| Skeleton Knight | Dig Two Graves | Reaction | **text** — the GM's to play |
| Skeleton Warrior | Only Bones | Passive | **scripted** — runs as an ability |
| Skeleton Warrior | Won't Stay Dead | Reaction | **text** — the GM's to play |
| Spellblade | Arcane Steel | Passive | **text** — the GM's to play |
| Spellblade | Suppressing Blast | Action | **scripted** — runs as an ability |
| Spellblade | Move as a Unit | Action | **scripted** — runs as an ability |
| Spellblade | Momentum | Reaction | **read** — read off the stat block |
| Swarm of Rats | Horde (1d4+1) | Passive | **read** — read off the stat block |
| Swarm of Rats | In Your Face | Passive | **text** — the GM's to play |
| Sylvan Soldier | Pack Tactics | Passive | **text** — the GM's to play |
| Sylvan Soldier | Forest Control | Action | **text** — the GM's to play |
| Sylvan Soldier | Blend In | Reaction | **text** — the GM's to play |
| Tangle Bramble Swarm | Horde (1d4+2) | Passive | **read** — read off the stat block |
| Tangle Bramble Swarm | Crush | Action | **text** — the GM's to play |
| Tangle Bramble Swarm | Encumber | Reaction | **scripted** — runs as an ability |
| Tangle Bramble | Minion (4) | Passive | **read** — read off the stat block |
| Tangle Bramble | Group Attack | Action | **scripted** — runs as an ability |
| Tangle Bramble | Drain and Multiply | Reaction | **text** — the GM's to play |
| Weaponmaster | Goading Strike | Action | **text** — the GM's to play |
| Weaponmaster | Adrenaline Burst | Action | **scripted** — runs as an ability |
| Weaponmaster | Momentum | Reaction | **read** — read off the stat block |
| Young Dryad | Voice of the Forest | Action | **scripted** — runs as an ability |
| Young Dryad | Thorny Cage | Action | **text** — the GM's to play |
| Young Dryad | Momentum | Reaction | **read** — read off the stat block |
| Brawny Zombie | Slow | Passive | **scripted** — runs as an ability |
| Brawny Zombie | Rend Asunder | Action | **text** — the GM's to play |
| Brawny Zombie | Rip and Tear | Reaction | **text** — the GM's to play |
| Patchwork Zombie Hulk | Destructible | Passive | **text** — the GM's to play |
| Patchwork Zombie Hulk | Flailing Limbs | Passive | **text** — the GM's to play |
| Patchwork Zombie Hulk | Another for the Pile | Action | **scripted** — runs as an ability |
| Patchwork Zombie Hulk | Tormented Screams | Action | **scripted** — runs as an ability |
| Rotted Zombie | Minion (3) | Passive | **read** — read off the stat block |
| Rotted Zombie | Group Attack | Action | **scripted** — runs as an ability |
| Shambling Zombie | Too Many to Handle | Passive | **text** — the GM's to play |
| Shambling Zombie | Horrifying | Passive | **scripted** — runs as an ability |
| Zombie Pack | Horde (1d4+2) | Passive | **read** — read off the stat block |
| Zombie Pack | Overwhelm | Reaction | **scripted** — runs as an ability |
| Archer Squadron | Horde (1d6+3) | Passive | **read** — read off the stat block |
| Archer Squadron | Focused Volley | Action | **text** — the GM's to play |
| Archer Squadron | Suppressing Fire | Action | **text** — the GM's to play |
| Apprentice Assassin | Minion (6) | Passive | **read** — read off the stat block |
| Apprentice Assassin | Group Attack | Action | **scripted** — runs as an ability |
| Assassin Poisoner | Grindletooth Venom | Passive | **scripted** — runs as an ability |
| Assassin Poisoner | Out of Nowhere | Passive | **scripted** — runs as an ability |
| Assassin Poisoner | Fumigation | Action | **text** — the GM's to play |
| Master Assassin | Won't See It Coming | Passive | **text** — the GM's to play |
| Master Assassin | Strike as One | Action | **text** — the GM's to play |
| Master Assassin | The Subtle Blade | Reaction | **text** — the GM's to play |
| Master Assassin | Momentum | Reaction | **read** — read off the stat block |
| Battle Box | Relentless (2) | Passive | **read** — read off the stat block |
| Battle Box | Randomized Tactics | Action | **text** — the GM's to play |
| Battle Box | Overcharge | Reaction | **text** — the GM's to play |
| Battle Box | Death Quake | Reaction | **text** — the GM's to play |
| Chaos Skull | Levitation | Passive | **text** — the GM's to play |
| Chaos Skull | Wards | Passive | **scripted** — runs as an ability |
| Chaos Skull | Magic Burst | Action | **scripted** — runs as an ability |
| Chaos Skull | Siphon Magic | Action | **text** — the GM's to play |
| Conscript | Minion (6) | Passive | **read** — read off the stat block |
| Conscript | Group Attack | Action | **scripted** — runs as an ability |
| Courtesan | Searing Glance | Reaction | **text** — the GM's to play |
| Cult Adept | Enervating Blast | Action | **text** — the GM's to play |
| Cult Adept | Shroud of the Fallen | Action | **text** — the GM's to play |
| Cult Adept | Shadow Shackles | Action | **text** — the GM's to play |
| Cult Adept | Fear Is Fuel | Reaction | **scripted** — runs as an ability |
| Cult Fang | Shadow's Embrace | Passive | **text** — the GM's to play |
| Cult Fang | Pick Off the Straggler | Action | **text** — the GM's to play |
| Cult Initiate | Minion (6) | Passive | **read** — read off the stat block |
| Cult Initiate | Group Attack | Action | **scripted** — runs as an ability |
| Demonic Hound Pack | Horde (2d4+1) | Passive | **read** — read off the stat block |
| Demonic Hound Pack | Dreadhowl | Action | **scripted** — runs as an ability |
| Demonic Hound Pack | Momentum | Reaction | **read** — read off the stat block |
| Electric Eels | Horde (2d4+1) | Passive | **read** — read off the stat block |
| Electric Eels | Paralyzing Shock | Action | **scripted** — runs as an ability |
| Elite Soldier | Reinforce | Action | **scripted** — runs as an ability |
| Elite Soldier | Vassal's Loyalty | Reaction | **text** — the GM's to play |
| Failed Experiment | Warped Fortitude | Passive | **scripted** — runs as an ability |
| Failed Experiment | Overwhelm | Passive | **text** — the GM's to play |
| Failed Experiment | Lurching Lunge | Action | **text** — the GM's to play |
| Giant Beastmaster | Two as One | Passive | **scripted** — runs as an ability |
| Giant Beastmaster | Pinning Strike | Action | **scripted** — runs as an ability |
| Giant Beastmaster | Deadly Companion | Action | **scripted** — runs as an ability |
| Giant Brawler | Battering Ram | Action | **text** — the GM's to play |
| Giant Brawler | Bloody Reprisal | Reaction | **scripted** — runs as an ability |
| Giant Brawler | Momentum | Reaction | **read** — read off the stat block |
| Giant Recruit | Minion (7) | Passive | **read** — read off the stat block |
| Giant Recruit | Group Attack | Action | **scripted** — runs as an ability |
| Giant Eagle | Flight | Passive | **scripted** — runs as an ability |
| Giant Eagle | Deadly Dive | Action | **scripted** — runs as an ability |
| Giant Eagle | Take Off- Action | — | **text** — the GM's to play |
| Giant Eagle | Deadly Drop | Action | **text** — the GM's to play |
| Gorgon | Relentless (2) | Passive | **read** — read off the stat block |
| Gorgon | Sunsear Arrows | Passive | **text** — the GM's to play |
| Gorgon | Crown of Serpents | Action | **scripted** — runs as an ability |
| Gorgon | Petrifying Gaze | Reaction | **text** — the GM's to play |
| Gorgon | Momentum | Reaction | **read** — read off the stat block |
| Juvenile Flickerfly | Relentless (3) | Passive | **read** — read off the stat block |
| Juvenile Flickerfly | Peerless Accuracy | Passive | **text** — the GM's to play |
| Juvenile Flickerfly | Mind Dance | Action | **scripted** — runs as an ability |
| Juvenile Flickerfly | Hallucinatory Breath | Reaction: Countdown (Loop 1d6) | **scripted** — runs as an ability |
| Knight of the Realm | Chevalier | Passive | **scripted** — runs as an ability |
| Knight of the Realm | Heavily Armored | Passive | **scripted** — runs as an ability |
| Knight of the Realm | Cavalry Charge | Action | **scripted** — runs as an ability |
| Knight of the Realm | For the Realm! | Action | **scripted** — runs as an ability |
| Masked Thief | Quick Hands | Action | **text** — the GM's to play |
| Masked Thief | Escape Plan | Action | **text** — the GM's to play |
| Merchant Baron | Everyone Has a Price | Action | **text** — the GM's to play |
| Merchant Baron | The Best Muscle Money Can Buy | Action | **text** — the GM's to play |
| Minotaur Wrecker | Ramp Up | Passive | **text** — the GM's to play |
| Minotaur Wrecker | Charging Bull | Action | **scripted** — runs as an ability |
| Minotaur Wrecker | Gore | Action | **scripted** — runs as an ability |
| Mortal Hunter | Terrifying | Passive | **read** — read off the stat block |
| Mortal Hunter | Deathlock | Action | **text** — the GM's to play |
| Mortal Hunter | Inevitable Death | Action | **scripted** — runs as an ability |
| Mortal Hunter | Rampage | Reaction: Countdown (Loop 1d6) | **text** — the GM's to play |
| Royal Advisor | Devastating Retort | Passive | **text** — the GM's to play |
| Royal Advisor | Bend Ears | Action | **text** — the GM's to play |
| Royal Advisor | Scapegoat | Action | **text** — the GM's to play |
| Secret-Keeper | Seize Your Moment | Action | **scripted** — runs as an ability |
| Secret-Keeper | Our Master's Will | Reaction | **text** — the GM's to play |
| Secret-Keeper | Summoning Ritual | Reaction: Countdown (6) | **scripted** — runs as an ability |
| Secret-Keeper | Fallen Hounds | Reaction | **scripted** — runs as an ability |
| Shark | Terrifying | Passive | **read** — read off the stat block |
| Shark | Rending Bite | Passive | **scripted** — runs as an ability |
| Shark | Blood in the Water | Reaction | **text** — the GM's to play |
| Siren | Captive Audience | Passive | **scripted** — runs as an ability |
| Siren | Enchanting Song | Action | **scripted** — runs as an ability |
| Spectral Archer | Ghost | Passive | **scripted** — runs as an ability |
| Spectral Archer | Pick Your Target | Action | **text** — the GM's to play |
| Spectral Captain | Ghost | Passive | **scripted** — runs as an ability |
| Spectral Captain | Unending Battle | Action | **text** — the GM's to play |
| Spectral Captain | Hold Fast | Reaction | **text** — the GM's to play |
| Spectral Captain | Momentum | Reaction | **read** — read off the stat block |
| Spectral Guardian | Ghost | Passive | **scripted** — runs as an ability |
| Spectral Guardian | Grave Blade | Action | **scripted** — runs as an ability |
| Spy | Gathering Secrets | Action | **text** — the GM's to play |
| Spy | Fly on the Wall | Reaction | **text** — the GM's to play |
| Stonewraith | Stonestrider | Passive | **text** — the GM's to play |
| Stonewraith | Rocky Ambush | Action | **text** — the GM's to play |
| Stonewraith | Avalanche Roar | Action | **scripted** — runs as an ability |
| Stonewraith | Momentum | Reaction | **read** — read off the stat block |
| War Wizard | Battle Teleport | Passive | **scripted** — runs as an ability |
| War Wizard | Refresh Warding Sphere | Action | **text** — the GM's to play |
| War Wizard | Eruption | Action | **text** — the GM's to play |
| War Wizard | Arcane Artillery | Action | **scripted** — runs as an ability |
| War Wizard | Warding Sphere | Reaction | **scripted** — runs as an ability |
| Adult Flickerfly | Relentless (4) | Passive | **read** — read off the stat block |
| Adult Flickerfly | Never Misses | Passive | **text** — the GM's to play |
| Adult Flickerfly | Deadly Flight | Passive | **text** — the GM's to play |
| Adult Flickerfly | Whirlwind | Action | **scripted** — runs as an ability |
| Adult Flickerfly | Mind Dance | Action | **scripted** — runs as an ability |
| Adult Flickerfly | Hallucinatory Breath | Reaction: Countdown (Loop 1d6) | **scripted** — runs as an ability |
| Adult Flickerfly | Uncanny Reflexes | Reaction | **text** — the GM's to play |
| Demon of Avarice | Money Talks | Passive | **scripted** — runs as an ability |
| Demon of Avarice | Numbers Must Go Up | Passive | **text** — the GM's to play |
| Demon of Avarice | Money Is Time | Action | **scripted** — runs as an ability |
| Demon of Despair | Depths of Despair | Passive | **scripted** — runs as an ability |
| Demon of Despair | Your Struggle Is Pointless | Action | **text** — the GM's to play |
| Demon of Despair | Your Friends Will Fail You | Reaction | **scripted** — runs as an ability |
| Demon of Despair | Momentum | Reaction | **read** — read off the stat block |
| Demon of Hubris | Terrifying | Passive | **read** — read off the stat block |
| Demon of Hubris | Double or Nothing | Passive | **text** — the GM's to play |
| Demon of Hubris | Unparalleled Skill | Action | **scripted** — runs as an ability |
| Demon of Hubris | The Root of Villainy | Action | **scripted** — runs as an ability |
| Demon of Hubris | You Pale in Comparison | Reaction | **scripted** — runs as an ability |
| Demon of Jealousy | Unprotected Mind | Passive | **scripted** — runs as an ability |
| Demon of Jealousy | My Turn | Reaction | **text** — the GM's to play |
| Demon of Jealousy | Rivalry | Reaction | **text** — the GM's to play |
| Demon of Jealousy | What's Yours Is Mine | Reaction | **text** — the GM's to play |
| Demon of Wrath | Anger Unrelenting | Passive | **scripted** — runs as an ability |
| Demon of Wrath | Battle Lust | Action | **text** — the GM's to play |
| Demon of Wrath | Retaliation | Reaction | **scripted** — runs as an ability |
| Demon of Wrath | Blood and Souls | Reaction: Countdown (Loop 6) | **scripted** — runs as an ability |
| Dire Bat | Flying | Passive | **scripted** — runs as an ability |
| Dire Bat | Screech | Action | **text** — the GM's to play |
| Dire Bat | Guardian | Reaction | **text** — the GM's to play |
| Dryad | Bramble Patch | Action | **text** — the GM's to play |
| Dryad | Grow Saplings | Action | **text** — the GM's to play |
| Dryad | We Are All One | Reaction | **text** — the GM's to play |
| Elemental Spark | Minion (9) | Passive | **read** — read off the stat block |
| Elemental Spark | Group Attack | Action | **scripted** — runs as an ability |
| Greater Earth Elemental | Slow | Passive | **scripted** — runs as an ability |
| Greater Earth Elemental | Crushing Blows | Passive | **scripted** — runs as an ability |
| Greater Earth Elemental | Immovable Object | Passive | **scripted** — runs as an ability |
| Greater Earth Elemental | Rockslide | Action | **scripted** — runs as an ability |
| Greater Earth Elemental | Momentum | Reaction | **read** — read off the stat block |
| Greater Water Elemental | Water Jet | Action | **scripted** — runs as an ability |
| Greater Water Elemental | Drowning Embrace | Action | **scripted** — runs as an ability |
| Greater Water Elemental | High Tide | Reaction | **text** — the GM's to play |
| Huge Green Ooze | Slow | Passive | **scripted** — runs as an ability |
| Huge Green Ooze | Acidic Form | Passive | **scripted** — runs as an ability |
| Huge Green Ooze | Envelop | Action | **text** — the GM's to play |
| Huge Green Ooze | Split | Reaction | **scripted** — runs as an ability |
| Hydra | Many-Headed Menace | Passive | **text** — the GM's to play |
| Hydra | Relentless (X) | Passive | **read** — read off the stat block |
| Hydra | Regeneration | Action | **scripted** — runs as an ability |
| Hydra | Terrifying Chorus | Action | **scripted** — runs as an ability |
| Hydra | Magical Weakness | Reaction | **text** — the GM's to play |
| Monarch | Execute Them! | Action | **text** — the GM's to play |
| Monarch | Crownsguard | Action | **text** — the GM's to play |
| Monarch | Casus Belli | Reaction: Long-Term Countdown (8) | **text** — the GM's to play |
| Stag Knight | From Above | Passive | **text** — the GM's to play |
| Stag Knight | Blade of the Forest | Action | **text** — the GM's to play |
| Stag Knight | Thorny Armor | Reaction | **scripted** — runs as an ability |
| Oak Treant | Just a Tree | Passive | **text** — the GM's to play |
| Oak Treant | Seed Barrage | Action | **text** — the GM's to play |
| Oak Treant | Take Root | Action | **scripted** — runs as an ability |
| Head Vampire | Terrifying | Passive | **read** — read off the stat block |
| Head Vampire | Look into My Eyes | Passive | **text** — the GM's to play |
| Head Vampire | Feed on Followers | Action | **text** — the GM's to play |
| Head Vampire | The Hunt Is On | Action | **scripted** — runs as an ability |
| Head Vampire | Lifesuck | Reaction | **text** — the GM's to play |
| Treant Sapling | Minion (6) | Passive | **read** — read off the stat block |
| Treant Sapling | Group Attack | Action | **scripted** — runs as an ability |
| Vampire | Draining Bite | Action | **scripted** — runs as an ability |
| Vampire | Mistform | Reaction | **text** — the GM's to play |
| Vault Guardian Gaoler | Blocking Shield | Passive | **scripted** — runs as an ability |
| Vault Guardian Gaoler | Lock Up | Action | **scripted** — runs as an ability |
| Vault Guardian Sentinel | Kinetic Slam | Passive | **scripted** — runs as an ability |
| Vault Guardian Sentinel | Box In | Action | **text** — the GM's to play |
| Vault Guardian Sentinel | Mana Bolt | Action | **scripted** — runs as an ability |
| Vault Guardian Sentinel | Momentum | Reaction | **read** — read off the stat block |
| Vault Guardian Turret | Slow Firing | Passive | **scripted** — runs as an ability |
| Vault Guardian Turret | Mark Target | Action | **text** — the GM's to play |
| Vault Guardian Turret | Concentrate Fire | Reaction | **text** — the GM's to play |
| Vault Guardian Turret | Detonation | Reaction | **text** — the GM's to play |
| Young Ice Dragon | Relentless (3) | Passive | **read** — read off the stat block |
| Young Ice Dragon | Rend and Crush | Passive | **text** — the GM's to play |
| Young Ice Dragon | No Hope | Passive | **scripted** — runs as an ability |
| Young Ice Dragon | Blizzard Breath | Action | **text** — the GM's to play |
| Young Ice Dragon | Avalanche | Action | **scripted** — runs as an ability |
| Young Ice Dragon | Frozen Scales | Reaction | **scripted** — runs as an ability |
| Young Ice Dragon | Momentum | Reaction | **read** — read off the stat block |
| Arch-Necromancer | Dance of Death | Action | **scripted** — runs as an ability |
| Arch-Necromancer | Beam of Decay | Action | **scripted** — runs as an ability |
| Arch-Necromancer | Open the Gates of Death | Action | **scripted** — runs as an ability |
| Arch-Necromancer | Not Today, My Dears | Reaction | **text** — the GM's to play |
| Arch-Necromancer | Your Life Is Mine | Reaction: Countdown (Loop 2d6) | **scripted** — runs as an ability |
| Fallen Shock Troop | Minion (12) | Passive | **read** — read off the stat block |
| Fallen Shock Troop | Aura of Doom | Passive | **scripted** — runs as an ability |
| Fallen Shock Troop | Group Attack | Action | **scripted** — runs as an ability |
| Fallen Sorcerer | Conflagration | Action | **scripted** — runs as an ability |
| Fallen Sorcerer | Nightmare Tableau | Action | **text** — the GM's to play |
| Fallen Sorcerer | Slippery | Reaction | **scripted** — runs as an ability |
| Fallen Sorcerer | Shackles of Guilt | Reaction: Countdown (Loop 2d6) | **scripted** — runs as an ability |
| Fallen Warlord: Realm-Breaker | Relentless (2) | Passive | **read** — read off the stat block |
| Fallen Warlord: Realm-Breaker | Firespite Plate Armor | Passive | **scripted** — runs as an ability |
| Fallen Warlord: Realm-Breaker | Tormenting Lash | Action | **text** — the GM's to play |
| Fallen Warlord: Realm-Breaker | All-Consuming Rage | Reaction: Countdown (Decreasing 8) | **scripted** — runs as an ability |
| Fallen Warlord: Realm-Breaker | Doombringer | Reaction | **text** — the GM's to play |
| Fallen Warlord: Realm-Breaker | I Have Never Known Defeat (Phase Change) | Reaction | **scripted** — runs as an ability |
| Fallen Warlord: Undefeated Champion | Relentless (3) | Passive | **read** — read off the stat block |
| Fallen Warlord: Undefeated Champion | Faltering Armor | Passive | **scripted** — runs as an ability |
| Fallen Warlord: Undefeated Champion | Shattering Strike | Action | **text** — the GM's to play |
| Fallen Warlord: Undefeated Champion | Endless Legions | Action | **scripted** — runs as an ability |
| Fallen Warlord: Undefeated Champion | Circle of Defilement | Reaction: Countdown (1d8) | **text** — the GM's to play |
| Fallen Warlord: Undefeated Champion | Momentum | Reaction | **read** — read off the stat block |
| Fallen Warlord: Undefeated Champion | Doombringer | Reaction | **text** — the GM's to play |
| Hallowed Archer | Punish the Guilty | Passive | **scripted** — runs as an ability |
| Hallowed Archer | Divine Volley | Action | **text** — the GM's to play |
| Hallowed Soldier | Minion (13) | Passive | **read** — read off the stat block |
| Hallowed Soldier | Divine Flight | Passive | **text** — the GM's to play |
| Hallowed Soldier | Group Attack | Action | **scripted** — runs as an ability |
| High Seraph | Relentless (3) | Passive | **read** — read off the stat block |
| High Seraph | Divine Flight | Passive | **text** — the GM's to play |
| High Seraph | Judgment | Action | **scripted** — runs as an ability |
| High Seraph | God Rays | Action | **scripted** — runs as an ability |
| High Seraph | We Are One | Action | **scripted** — runs as an ability |
| Kraken | Relentless (3) | Passive | **read** — read off the stat block |
| Kraken | Many Tentacles | Passive | **text** — the GM's to play |
| Kraken | Grapple and Drown | Action | **text** — the GM's to play |
| Kraken | Boiling Blast | Action | **scripted** — runs as an ability |
| Kraken | Momentum | Reaction | **read** — read off the stat block |
| Oracle of Doom | Terrifying | Passive | **read** — read off the stat block |
| Oracle of Doom | Walls Closing In | Passive | **text** — the GM's to play |
| Oracle of Doom | Pronounce Fate | Action | **scripted** — runs as an ability |
| Oracle of Doom | Summon Tormentors | Action | **text** — the GM's to play |
| Oracle of Doom | Ominous Knowledge | Reaction | **text** — the GM's to play |
| Oracle of Doom | Vengeful Fate | Reaction | **scripted** — runs as an ability |
| Outer Realms Abomination | Chaotic Form | Passive | **text** — the GM's to play |
| Outer Realms Abomination | Disorienting Presence | Passive | **text** — the GM's to play |
| Outer Realms Abomination | Reality Quake | Action | **text** — the GM's to play |
| Outer Realms Abomination | Unreal Form | Reaction | **scripted** — runs as an ability |
| Outer Realms Corruptor | Will-Shattering Touch | Passive | **scripted** — runs as an ability |
| Outer Realms Corruptor | Disgorge Reality Flotsam | Action | **scripted** — runs as an ability |
| Outer Realms Thrall | Minion (13) | Passive | **read** — read off the stat block |
| Outer Realms Thrall | Group Attack | Action | **scripted** — runs as an ability |
| Volcanic Dragon: Obsidian Predator | Relentless (2) | Passive | **read** — read off the stat block |
| Volcanic Dragon: Obsidian Predator | Flying | Passive | **scripted** — runs as an ability |
| Volcanic Dragon: Obsidian Predator | Obsidian Scales | Passive | **scripted** — runs as an ability |
| Volcanic Dragon: Obsidian Predator | Avalanche Tail | Action | **scripted** — runs as an ability |
| Volcanic Dragon: Obsidian Predator | Dive-Bomb | Action | **scripted** — runs as an ability |
| Volcanic Dragon: Obsidian Predator | Erupting Rage (Phase Change) | Reaction | **scripted** — runs as an ability |
| Volcanic Dragon: Molten Scourge | Relentless (3) | Passive | **read** — read off the stat block |
| Volcanic Dragon: Molten Scourge | Cracked Scales | Passive | **text** — the GM's to play |
| Volcanic Dragon: Molten Scourge | Shattering Might | Action | **scripted** — runs as an ability |
| Volcanic Dragon: Molten Scourge | Eruption | Action | **text** — the GM's to play |
| Volcanic Dragon: Molten Scourge | Volcanic Breath | Reaction | **text** — the GM's to play |
| Volcanic Dragon: Molten Scourge | Lava Splash | Reaction | **scripted** — runs as an ability |
| Volcanic Dragon: Molten Scourge | Ashen Vengeance (Phase Change) | Reaction | **scripted** — runs as an ability |
| Volcanic Dragon: Ashen Tyrant | Relentless (4) | Passive | **read** — read off the stat block |
| Volcanic Dragon: Ashen Tyrant | Cornered | Passive | **text** — the GM's to play |
| Volcanic Dragon: Ashen Tyrant | Injured Wings | Passive | **scripted** — runs as an ability |
| Volcanic Dragon: Ashen Tyrant | Ashes to Ashes | Passive | **scripted** — runs as an ability |
| Volcanic Dragon: Ashen Tyrant | Desperate Rampage | Action | **scripted** — runs as an ability |
| Volcanic Dragon: Ashen Tyrant | Ashen Cloud | Action | **text** — the GM's to play |
| Volcanic Dragon: Ashen Tyrant | Apocalyptic Thrashing | Action: Countdown (1d12) | **scripted** — runs as an ability |
| Perfected Zombie | Terrifying | Passive | **read** — read off the stat block |
| Perfected Zombie | Fearsome Presence | Passive | **text** — the GM's to play |
| Perfected Zombie | Perfect Strike | Action | **scripted** — runs as an ability |
| Perfected Zombie | Skilled Opportunist | Reaction | **text** — the GM's to play |
| Zombie Legion | Horde (2d6+5) | Passive | **read** — read off the stat block |
| Zombie Legion | Unyielding | Passive | **scripted** — runs as an ability |
| Zombie Legion | Relentless (2) | Passive | **read** — read off the stat block |
| Zombie Legion | Overwhelm | Reaction | **text** — the GM's to play |
