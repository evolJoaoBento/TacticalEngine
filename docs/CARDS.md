# Domain cards: what the engine runs

Every SRD domain card is held, shown and counted toward the loadout. The ones marked here
as **action**, **reaction** or **passive** are scripted in `src/engine/content/srd/abilities.ts`
and run through the one effect vocabulary; the rest are **text**: the card's words are shown on
the action bar and the table adjudicates, as at a real one. A grimoire lists each spell.

Known simplifications in the scripted ones:

- **Rune Ward** never breaks on an 8; **Get Back Up**, **Iron Will**, **Brace**, **Shrug It Off**, **On the Brink** and the ward fire on their own when they lower the Hit Points marked (per-card `auto`, and an interrupt is always asked).
- **Arcane Barrage**, **Falling Sky** and **Wild Flame** offer a short list of amounts rather than any number; **Unleash Chaos** and **Share the Burden** ask outright, one button per number, up to twelve.
- **Slumber**'s sleeper loses its spotlight until damage marks a Hit Point or the GM spends a Fear, which the GM's turn does on its own when there is one.
- **Stunning Sunlight** rolls the damage for those who resist as its own roll, because the card prints different dice for it; **Earthquake** and **Ground Pound** roll once and halve that number, as the card asks.
- **Cinder Grasp** lights a target On Fire, but the extra damage for acting while alight is the condition's text and the table's to apply. **Chokehold** makes a target Vulnerable without the card's stronger version of it, and **Corrosive Projectile** deals its damage without the standing Corroded penalty.
- **Chain Lightning** strikes the first ring; the chain onward from each wounded target is the table's. **Vicious Entangle** binds the one target, not the second bought with a Hope.
- **Cruel Precision** adds Finesse rather than the better of Finesse and Agility; **Voice of Reason**'s Proficiency bonus applies wherever Proficiency is read, not to damage alone; **Second Wind** does not branch on Hope, so the ally's share of it is text.
- **Inspirational Words** and **Restoration** spend one token at a time. **Fire Flies** is one of Conjure Swarm's two swarms; the beetles that soak a blow are text.
- Four of the nine **-Touched** cards carry a bonus the sheet can hold (Arcana, Blade, Splendor, Valor); the rest ask for something the engine has no number for and stay text.
- **Healing Strike** clears a Hit Point on the nearest ally rather than a chosen one: it answers a swing that has already landed, and what the player is asked is whether to spend the Hope.
- **Ferocity** and **Never Upstaged** keep their bonus as tokens on the card, so the Evasion or the damage is whatever the fight put there; Ferocity is spent by the next attack made at its holder, hit or miss.
- **Enrapture** and **Mass Enrapture** put the name on the target and let the condition carry it: a creature whose attention is fixed on one person is two Evasion easier to hit, and whom it attacks is still the table's call. **Glyph of Nightfall** is worth a flat two rather than the caster's Knowledge, because a condition carries one number rather than the number of whoever applied it. **Death Grip** offers the pull and the constriction, not the vines catching everyone in between: that is a line across the map, and a selector reads bands around a creature.
- **Spellcharge** takes any wound rather than magic damage alone and is not capped at the caster's Spellcast trait; **Twilight Toll** is worth one die rather than growing with every success that rolled no damage. **Sigil of Retribution** holds a die for every blow without the cap of the caster's level, and recasting it moves the sigil while leaving the dice already on the card - the card clears them when they are rolled and nowhere else.
- The cards that last are conditions: **Frenzy** lasts the fight rather than "until there are no more adversaries within sight"; **Deadly Focus** lasts it too, because nothing tells a condition who it was about; **Battle Cry** reaches Far and its advantage lasts the fight, where the card ends it on a failure with Fear that no card is told about; and **Night Terror**'s Horrified is Vulnerable and nothing else.
- **Unyielding Armor** is offered against any blow the defender is asked about rather than at the moment they would mark an Armor Slot, which is a decision they have not made when the question is put, and its step comes after whatever the armor did. **I See It Coming** is asked once the swing has landed rather than as it is aimed, so a blow that was going to miss anyway never costs a Stress.
- **Arcane Reflection** answers any blow the defender is asked about rather than magic damage alone, and what it sends back is the number that arrived without the attack's own directness. **Redirect** spends its Stress on the attempt rather than after the dice come up, and turns the blow onto the nearest adversary within Very Close rather than one the player picks.
- **Thorn Skin** and **Scramble** answer the blow the defender is asked about, which is a standard attack: damage dealt by a feature's own script arrives without a question, so neither of them hears it. **Scramble** leaves the ground it was standing on but a creature that follows is the table's, and the swing it avoided earns its attacker nothing - no rider, no Momentum.
- The four cards that answer a critical each make one choice for everyone rather than asking each person: **Critical Inspiration** and **Rousing Strike** hand the room one answer, **Rousing Strike** reads "who can see or hear you" as Far range and clears two Stress rather than 1d4, and **Champion's Edge** asks for its three in the order the card prints them. **Gore and Glory** answers the critical half only - nothing tells the one swinging that what they hit has fallen.
- **Rage Up** is asked once per attack rather than twice, and after the swing lands rather than before it is made - which spends its Stress only on a blow that is going to be counted. **Onslaught** floors a blow at the Major band rather than reading the target's own Major threshold as a number, which is the same two Hit Points; its second half answers an area blow that caught its holder as well as an ally.
- **Breaking Blow** leaves its crack for the holder's own next hit: nothing raises a party member's blow to the rest of the party, so an ally's swing does not cash the mark. **Rapid Riposte** hits back with the primary weapon rather than a choice of active ones.
- **Battle Monster** throws the damage roll away and marks the Hit Points the caster is carrying, past thresholds, resistance and Armor Slots - which is what "instead of rolling for damage" asks for.
- **Unbreakable** is offered as one of the death move's own options rather than before the question is put, which is what "instead of making a death move" comes to; the card goes to the vault afterwards, as it says, and the Recall Cost brings it back.
- **Battle-Hardened** is offered inside the death prompt beside Unbreakable, and **Glancing Blow** answers the holder's own miss before the turn is spent - a miss hands the spotlight over, and a question raised after that is one the player answers on somebody else's turn.
- **Versatile Fighter** scripts the half that belongs to a swing: the trait swap is a choice made when the sheet is written and stays text, and the die lifted is the lowest of the roll, which is the one anybody would pick. **Reaper's Strike** reads its “which targets it would succeed against” as one roll against every Difficulty the weapon reaches, and the choice among the ones it beat goes to the nearest.
- **Boost** treats the ally as a gate rather than a target: nothing is asked of them and nothing happens to them, so the card only has to know one is standing close enough to push off. **Deft Maneuvers** runs to an adversary and ends in Melee of them rather than to a point on the map, because the board picks creatures and not tiles; it is not the character's action, so the attack that follows still is.
- **Deathrun** is the first card aimed at the ground rather than at anybody: the player picks a tile, the board shows what the line would go through before the click, and what the run passes is what it hits. Simplified: the ladder of shrinking damage rolls and the order to deal them in is one roll, the same damage to everyone it beat, which is what every other attack against several targets here does; the card's own +1 to Proficiency is kept.
- **Goad Them On** leaves the Stress and the disadvantage; whom a goaded creature has to swing at is the GM's, the way Enrapture's is. **Overwhelming Aura** scripts the price on swinging at its bearer and not the Presence swap: a condition carries a number rather than one trait's name copied onto another.
- **Wrangle** spends the Hope whenever there is one rather than offering it, treats every ally as a willing one, and blinks what it moves rather than walking it - a creature hauled across the room does not have to find a path. The Close range is on the destination, measured from the caster.
- **Reassurance** throws both Duality Dice again; **Support Tank** always throws the Fear Die, it being the one anybody would pick. Neither touches the advantage die or the Help dice, which belong to the roll rather than to the hands that threw it. Both answer the party's weapon swing only: a check made through the runner is not held anywhere it could be rerolled.
- **Wild Surge**'s die grows on every action roll the engine hears about, which is the party's weapon swings and the rolls a script makes; a roll nothing raises does not feed it.
- **Full Surge**'s "+2 bonus to all of your character traits" is +2 on every action roll, a trait being the thing you roll; a trait read anywhere that is not a roll does not move. It lasts to the next rest rather than the next long one, there being one rest a condition outlasts.
- The **Book of Korvax** runs two of its three spells. Its circle is the first ground that bites: the crossing is the whole of the spell, so standing still in one sets nothing off, and recasting it leaves the people already inside bearing it rather than hitting them twice. **Lift** sets its target down away from the caster rather than anywhere within Close of where they were - there is no way to aim the second half of a spell aimed at a creature - and on ground that can be walked to, so a lift carries nobody over a wall. The Reaction Roll that makes somebody forget the last minute of a conversation stays text.
- **Hold the Line** is the second card built on ground that bites, and of the three ways its stance ends only the failure with Fear is scripted: "until you move" needs a hook on the holder's own walk that nothing raises, and the GM spending 2 Fear to clear it is the GM's to spend. The stance otherwise stands until the fight ends or the one holding it falls, and the hold it leaves is the ordinary Restrained, shaken off on the creature's next spotlight.
- The **Book of Sitil** runs one spell of its three: the echo that lets an ally's next attack reach a second target the same roll would have beaten. The additional target is the nearest other adversary the swing reaches, chosen the way every other automatic pick here is, and the mark is spent whether or not the roll beats them - the attack it was waiting for has been made. Shifting your appearance to avoid recognition and an illusion that holds up until somebody is within Melee of it are both about being looked at, which nothing here models, and stay text.
- The remaining Codex grimoires, four of seven with something a fight can use. **Vagras**: Arcane Door is the caster's own blink to the spot they pointed at, the portal closing behind the one creature that went through it; Reveal takes Hidden off whatever its roll beat, creatures being the only thing here that can be magically hidden; Runic Lock stays text. **Grynn**: Arcane Deflection takes a blow four bands down, which is any blow to nothing, and answers only the holder's own skin - a blow aimed at somebody else is answered by standing in front of them, which is a different card; Wall of Flame is a patch of ground around the one point the player picked rather than a line between two, the board aiming at a tile and not at a pair; Time Lock stays text. **Ronin**: Eternal Enervation is Vulnerable at the `permanent` duration, which outlives the scene as the card asks. **Yarrow**: Timejammer stops every adversary within Far rather than literally everyone, a party member frozen out of their own turn being a worse game than the card intends, and it is released by the caster's next attack, hit or miss - which is what "an action roll that targets another creature" comes to here.
- Three grimoires run nothing, and the reason is the same each time: they are about being looked at, being somewhere else, or asking the GM a question. **Exota** interrupts a magical effect nothing here raises, and animates a construct whose stat block is the caster's own traits, which `summon` cannot read off anybody. **Homet** passes through walls and opens a gate to another plane. **Vyola** reads a memory the GM narrates, and shares Stress between two creatures at a moment nothing raises.
- **Tempest** is three storms behind one roll, and the choice among them is the player's. The Blizzard is whole. The Hurricane's "choose a direction the wind is blowing; targets can't move against the wind" is a direction the board cannot hold, so what lands is the damage. The Sandstorm's "attacks made from beyond Melee range have disadvantage" is about where the attacker is standing, and a modifier reads from one creature rather than the distance between two - so it makes every attack aimed at them harder, Melee included. All three last the scene rather than "until the GM spends a Fear", there being nobody at that end of the table to spend it.
- **Force of Nature** runs the +10 and the upkeep, which is the shape of the card: a form that costs a Hope every time it is used, and drops off whoever cannot pay. Absorbing a creature you defeated needs a moment nothing raises on the party's side, and "you can't be Restrained" needs a creature immune to a condition, which nothing here can say; both stay text. The Hope is taken after the roll rather than before it, which differs only for a character down to their last one.
- The rest of Sage stays text for reasons that repeat: **Natural Familiar**, **Forest Sprites** and **Conjured Steeds** put a creature on the board whose whole purpose is to stand near somebody else - the third-creature rule this engine does not read - **Wild Fortress** builds a thing with its own damage thresholds, **Plant Dominion** reshapes terrain, **Forager** is a downtime move, and **Nature's Tongue**, **Gifted Tracker** and **Sage-Touched** each turn on a natural environment or a creature you have tracked, neither of which the engine knows about.
- **Fane of the Wilds** is the first card to reach a roll *after* it was read. The spend is made rather than asked - the least number of tokens that carries the total over the Difficulty, and none when the roll needs no saving or cannot be saved - because the moment belongs to the runner, which has nobody to ask. Its tokens are the Sage cards in the loadout, the vault being a place a card goes rather than a number to count, and the token it should gain on a critical Sage spell is not there: nothing tells a card which domain the spell that just critted came from.
- **Signature Move** is the only card that changes what is thrown rather than what is added to it: a d20 in place of the d12 Hope Die, which raises the floor of the roll and makes a critical rarer, both of which the card is buying deliberately. Declaring the move is a free thing done before rolling rather than folded into an action, the engine having no way to hear "as part of" an action that has not happened yet. **Tactician** says the same words about a Tag Team Roll, which this engine does not have, and stays text along with its half about lending an Experience to somebody else's roll.
- **Strategic Approach** spends its token *before* the swing rather than during it, which is what keeps all three of its options: advantage has to be declared before the dice, so a card that asked afterwards could only ever have offered two of the three. Its gate - "the first time you move within Close range of an adversary" - is not tracked, nothing here remembering that a character walked before they swung; the cost of both is a player who picks their line and then cannot reach anybody, which is a wasted token rather than a wrong rule.
- **Know Thy Enemy** leaves the Hope it costs and the Fear it can take. The information is the table's: the engine already shows every number on that list when you look at a creature, but the effect vocabulary cannot read those numbers into a sentence. The Fear is offered rather than taken, a Stress being a real price and "you can" the card's own word.
- **Invisibility** keeps its die and its clock: attacks against the hidden creature are made with disadvantage, and every action they take spends one of the tokens the caster's Spellcast trait placed. Two simplifications. The tokens sit with the one who is invisible rather than on the caster's card, which is what lets an ally spend them at all; and "yourself or an ally" is an ally, because a caster who chose themselves would spend the first token on the Spellcast Roll that cast it. Not being seen except by magical means is the table's.
- **Troublemaker** is the first card to roll dice for an *amount* rather than for damage: a number of d4s scaled by Proficiency, and the best single face of them, marked as Stress on whatever the taunt beat.
- Cards that ask for a Presence Roll to compel, a Countdown, Hidden/Cloaked, flight, teleportation, a summon, or a GM's discretion stay text.

Scripted: 129 of 189 cards.


## Arcana

| Level | Card | Type | Engine |
|---|---|---|---|
| 1 | Rune Ward | Spell | **reaction** |
| 1 | Unleash Chaos | Spell | **action** |
| 1 | Wall Walk | Spell | text |
| 2 | Cinder Grasp | Spell | **action** |
| 2 | Floating Eye | Spell | text |
| 3 | Counterspell | Spell | text |
| 3 | Flight | Spell | text |
| 4 | Blink Out | Spell | **action** |
| 4 | Preservation Blast | Spell | **action** |
| 5 | Chain Lightning | Spell | **action** |
| 5 | Premonition | Spell | text |
| 6 | Rift Walker | Spell | text |
| 6 | Telekinesis | Spell | text |
| 7 | Arcana-Touched | Ability | **passive** |
| 7 | Cloaking Blast | Spell | text |
| 8 | Arcane Reflection | Spell | **reaction** |
| 8 | Confusing Aura | Spell | text |
| 9 | Earthquake | Spell | **action** |
| 9 | Sensory Projection | Spell | text |
| 10 | Adjust Reality | Spell | text |
| 10 | Falling Sky | Spell | **action** |

## Blade

| Level | Card | Type | Engine |
|---|---|---|---|
| 1 | Get Back Up | Ability | **reaction** |
| 1 | Not Good Enough | Ability | **reaction** |
| 1 | Whirlwind | Ability | **action** |
| 2 | A Soldier's Bond | Ability | **action** |
| 2 | Reckless | Ability | **action** |
| 3 | Scramble | Ability | **reaction** |
| 3 | Versatile Fighter | Ability | **reaction** |
| 4 | Deadly Focus | Ability | **action** |
| 4 | Fortified Armor | Ability | **passive** |
| 5 | Champion's Edge | Ability | **reaction** |
| 5 | Vitality | Ability | text |
| 6 | Battle-Hardened | Ability | **reaction** |
| 6 | Rage Up | Ability | **reaction** |
| 7 | Blade-Touched | Ability | **passive** |
| 7 | Glancing Blow | Ability | **reaction** |
| 8 | Battle Cry | Ability | **action** |
| 8 | Frenzy | Ability | **action** |
| 9 | Gore and Glory | Ability | **reaction** |
| 9 | Reaper's Strike | Ability | **action** |
| 10 | Battle Monster | Ability | **reaction** |
| 10 | Onslaught | Ability | **reaction** |

## Bone

| Level | Card | Type | Engine |
|---|---|---|---|
| 1 | Deft Maneuvers | Ability | **action** |
| 1 | I See It Coming | Ability | **reaction** |
| 1 | Untouchable | Ability | **passive** |
| 2 | Ferocity | Ability | **reaction**, **passive** |
| 2 | Strategic Approach | Ability | **action**, **reaction** |
| 3 | Brace | Ability | **reaction** |
| 3 | Tactician | Ability | text |
| 4 | Boost | Ability | **action** |
| 4 | Redirect | Ability | **reaction** |
| 5 | Know Thy Enemy | Ability | **action** |
| 5 | Signature Move | Ability | **action**, **reaction** |
| 6 | Rapid Riposte | Ability | **reaction** |
| 6 | Recovery | Ability | text |
| 7 | Bone-Touched | Ability | text |
| 7 | Cruel Precision | Ability | **passive** |
| 8 | Breaking Blow | Ability | **reaction** |
| 8 | Wrangle | Ability | **action** |
| 9 | On the Brink | Ability | **reaction** |
| 9 | Splintering Strike | Ability | **action** |
| 10 | Deathrun | Ability | **action** |
| 10 | Swift Step | Ability | **reaction** |

## Codex

| Level | Card | Type | Engine |
|---|---|---|---|
| 1 | Book of Ava | Grimoire | **action** (Power Push), **action** (Tava's Armor), **action** (Ice Spike) |
| 1 | Book of Illiat | Grimoire | **action** (Slumber), **action** (Arcane Barrage) |
| 1 | Book of Tyfar | Grimoire | **action** (Wild Flame) |
| 2 | Book of Sitil | Grimoire | **action** (Echoing Strike), **reaction** (Echoing Strike) |
| 2 | Book of Vagras | Grimoire | **action** (Arcane Door), **action** (Reveal) |
| 3 | Book of Korvax | Grimoire | **action** (Lift), **action** (Magic Circle) |
| 3 | Book of Norai | Grimoire | **action** (Mystic Tether), **action** (Fireball) |
| 4 | Book of Exota | Grimoire | text |
| 4 | Book of Grynn | Grimoire | **reaction** (Arcane Deflection), **action** (Wall of Flame) |
| 5 | Manifest Wall | Spell | text |
| 5 | Teleport | Spell | text |
| 6 | Banish | Spell | text |
| 6 | Sigil of Retribution | Spell | **action**, **reaction** |
| 7 | Book of Homet | Grimoire | text |
| 7 | Codex-Touched | Ability | text |
| 8 | Book of Vyola | Grimoire | text |
| 8 | Safe Haven | Spell | text |
| 9 | Book of Ronin | Grimoire | **action** (Eternal Enervation) |
| 9 | Disintegration Wave | Spell | text |
| 10 | Book of Yarrow | Grimoire | **action** (Timejammer), **reaction** (Timejammer), **action** (Magic Immunity) |
| 10 | Transcendent Union | Spell | text |

## Grace

| Level | Card | Type | Engine |
|---|---|---|---|
| 1 | Deft Deceiver | Ability | text |
| 1 | Enrapture | Spell | **action** |
| 1 | Inspirational Words | Ability | **action** |
| 2 | Tell No Lies | Spell | text |
| 2 | Troublemaker | Ability | **action** |
| 3 | Hypnotic Shimmer | Spell | **action** |
| 3 | Invisibility | Spell | **action**, **reaction** |
| 4 | Soothing Speech | Ability | text |
| 4 | Through Your Eyes | Spell | text |
| 5 | Thought Delver | Spell | text |
| 5 | Words of Discord | Spell | **action** |
| 6 | Never Upstaged | Ability | **reaction**, **passive** |
| 6 | Share the Burden | Spell | **action** |
| 7 | Endless Charisma | Ability | text |
| 7 | Grace-Touched | Ability | text |
| 8 | Astral Projection | Spell | text |
| 8 | Mass Enrapture | Spell | **action** |
| 9 | Copycat | Spell | text |
| 9 | Master of the Craft | Ability | text |
| 10 | Encore | Spell | **reaction** |
| 10 | Notorious | Ability | text |

## Midnight

| Level | Card | Type | Engine |
|---|---|---|---|
| 1 | Pick and Pull | Ability | **text** |
| 1 | Rain of Blades | Spell | **action** |
| 1 | Uncanny Disguise | Spell | text |
| 2 | Midnight Spirit | Spell | **action** |
| 2 | Shadowbind | Spell | **action** |
| 3 | Chokehold | Ability | **action** |
| 3 | Veil of Night | Spell | text |
| 4 | Glyph of Nightfall | Spell | **action** |
| 4 | Stealth Expertise | Ability | text |
| 5 | Hush | Spell | text |
| 5 | Phantom Retreat | Spell | text |
| 6 | Dark Whispers | Spell | text |
| 6 | Mass Disguise | Spell | text |
| 7 | Midnight-Touched | Ability | text |
| 7 | Vanishing Dodge | Spell | **reaction** |
| 8 | Shadowhunter | Ability | text |
| 8 | Spellcharge | Spell | **reaction** |
| 9 | Night Terror | Spell | **action** |
| 9 | Twilight Toll | Ability | **action**, **reaction** |
| 10 | Eclipse | Spell | **action**, **reaction** |
| 10 | Specter of the Dark | Spell | **action** |

## Sage

| Level | Card | Type | Engine |
|---|---|---|---|
| 1 | Gifted Tracker | Ability | text |
| 1 | Nature's Tongue | Ability | text |
| 1 | Vicious Entangle | Spell | **action** |
| 2 | Conjure Swarm | Spell | **action** (Fire Flies) |
| 2 | Natural Familiar | Spell | text |
| 3 | Corrosive Projectile | Spell | **action** |
| 3 | Towering Stalk | Spell | **action** |
| 4 | Death Grip | Spell | **action** |
| 4 | Healing Field | Spell | **action** |
| 5 | Thorn Skin | Spell | **action**, **reaction** |
| 5 | Wild Fortress | Spell | text |
| 6 | Conjured Steeds | Spell | text |
| 6 | Forager | Ability | text |
| 7 | Sage-Touched | Ability | text |
| 7 | Wild Surge | Spell | **action**, **reaction** |
| 8 | Forest Sprites | Spell | text |
| 8 | Rejuvenation Barrier | Spell | **action** |
| 9 | Fane of the Wilds | Ability | **passive** |
| 9 | Plant Dominion | Spell | text |
| 10 | Force of Nature | Spell | **action**, **reaction** |
| 10 | Tempest | Spell | **action** |

## Splendor

| Level | Card | Type | Engine |
|---|---|---|---|
| 1 | Bolt Beacon | Spell | **action** |
| 1 | Mending Touch | Spell | **action** |
| 1 | Reassurance | Ability | **reaction** |
| 2 | Final Words | Spell | text |
| 2 | Healing Hands | Spell | **action** |
| 3 | Second Wind | Ability | **action** |
| 3 | Voice of Reason | Ability | **passive** |
| 4 | Divination | Spell | text |
| 4 | Life Ward | Spell | **action** |
| 5 | Shape Material | Spell | text |
| 5 | Smite | Spell | **action**, **reaction** |
| 6 | Restoration | Spell | **action** |
| 6 | Zone of Protection | Spell | **action** |
| 7 | Healing Strike | Spell | **reaction** |
| 7 | Splendor-Touched | Ability | **passive** |
| 8 | Shield Aura | Spell | **action** |
| 8 | Stunning Sunlight | Spell | **action** |
| 9 | Overwhelming Aura | Spell | **action** |
| 9 | Salvation Beam | Spell | **action** |
| 10 | Invigoration | Spell | text |
| 10 | Resurrection | Spell | text |

## Valor

| Level | Card | Type | Engine |
|---|---|---|---|
| 1 | Bare Bones | Ability | **passive** |
| 1 | Forceful Push | Ability | **action** |
| 1 | I Am Your Shield | Ability | **reaction** |
| 2 | Body Basher | Ability | **passive** |
| 2 | Bold Presence | Ability | text |
| 3 | Critical Inspiration | Ability | **reaction** |
| 3 | Lean on Me | Ability | **reaction** |
| 4 | Goad Them On | Ability | **action** |
| 4 | Support Tank | Ability | **reaction** |
| 5 | Armorer | Ability | **passive** |
| 5 | Rousing Strike | Ability | **reaction** |
| 6 | Inevitable | Ability | **reaction** |
| 6 | Rise Up | Ability | **passive**, **reaction** |
| 7 | Shrug It Off | Ability | **reaction** |
| 7 | Valor-Touched | Ability | **passive** |
| 8 | Full Surge | Ability | **action** |
| 8 | Ground Pound | Ability | **action** |
| 9 | Hold the Line | Ability | **action**, **reaction** |
| 9 | Lead by Example | Ability | **reaction** |
| 10 | Unbreakable | Ability | **reaction** |
| 10 | Unyielding Armor | Ability | **reaction** |
