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
- Cards that ask for a Presence Roll to compel, a Countdown, Hidden/Cloaked, flight, teleportation, a summon, or a GM's discretion stay text.

Scripted: 104 of 189 cards.


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
| 1 | Not Good Enough | Ability | **text** |
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
| 2 | Strategic Approach | Ability | text |
| 3 | Brace | Ability | **reaction** |
| 3 | Tactician | Ability | text |
| 4 | Boost | Ability | **action** |
| 4 | Redirect | Ability | **reaction** |
| 5 | Know Thy Enemy | Ability | text |
| 5 | Signature Move | Ability | text |
| 6 | Rapid Riposte | Ability | **reaction** |
| 6 | Recovery | Ability | text |
| 7 | Bone-Touched | Ability | text |
| 7 | Cruel Precision | Ability | **passive** |
| 8 | Breaking Blow | Ability | **reaction** |
| 8 | Wrangle | Ability | text |
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
| 2 | Book of Sitil | Grimoire | text |
| 2 | Book of Vagras | Grimoire | text |
| 3 | Book of Korvax | Grimoire | text |
| 3 | Book of Norai | Grimoire | **action** (Mystic Tether), **action** (Fireball) |
| 4 | Book of Exota | Grimoire | text |
| 4 | Book of Grynn | Grimoire | text |
| 5 | Manifest Wall | Spell | text |
| 5 | Teleport | Spell | text |
| 6 | Banish | Spell | text |
| 6 | Sigil of Retribution | Spell | **action**, **reaction** |
| 7 | Book of Homet | Grimoire | text |
| 7 | Codex-Touched | Ability | text |
| 8 | Book of Vyola | Grimoire | text |
| 8 | Safe Haven | Spell | text |
| 9 | Book of Ronin | Grimoire | text |
| 9 | Disintegration Wave | Spell | text |
| 10 | Book of Yarrow | Grimoire | text |
| 10 | Transcendent Union | Spell | text |

## Grace

| Level | Card | Type | Engine |
|---|---|---|---|
| 1 | Deft Deceiver | Ability | text |
| 1 | Enrapture | Spell | **action** |
| 1 | Inspirational Words | Ability | **action** |
| 2 | Tell No Lies | Spell | text |
| 2 | Troublemaker | Ability | text |
| 3 | Hypnotic Shimmer | Spell | **action** |
| 3 | Invisibility | Spell | text |
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
| 7 | Wild Surge | Spell | text |
| 8 | Forest Sprites | Spell | text |
| 8 | Rejuvenation Barrier | Spell | **action** |
| 9 | Fane of the Wilds | Ability | text |
| 9 | Plant Dominion | Spell | text |
| 10 | Force of Nature | Spell | text |
| 10 | Tempest | Spell | text |

## Splendor

| Level | Card | Type | Engine |
|---|---|---|---|
| 1 | Bolt Beacon | Spell | **action** |
| 1 | Mending Touch | Spell | **action** |
| 1 | Reassurance | Ability | text |
| 2 | Final Words | Spell | text |
| 2 | Healing Hands | Spell | **action** |
| 3 | Second Wind | Ability | **action** |
| 3 | Voice of Reason | Ability | **passive** |
| 4 | Divination | Spell | text |
| 4 | Life Ward | Spell | text |
| 5 | Shape Material | Spell | text |
| 5 | Smite | Spell | **action**, **reaction** |
| 6 | Restoration | Spell | **action** |
| 6 | Zone of Protection | Spell | **action** |
| 7 | Healing Strike | Spell | **reaction** |
| 7 | Splendor-Touched | Ability | **passive** |
| 8 | Shield Aura | Spell | **action** |
| 8 | Stunning Sunlight | Spell | **action** |
| 9 | Overwhelming Aura | Spell | text |
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
| 3 | Lean on Me | Ability | text |
| 4 | Goad Them On | Ability | text |
| 4 | Support Tank | Ability | text |
| 5 | Armorer | Ability | **passive** |
| 5 | Rousing Strike | Ability | **reaction** |
| 6 | Inevitable | Ability | text |
| 6 | Rise Up | Ability | **passive**, **reaction** |
| 7 | Shrug It Off | Ability | **reaction** |
| 7 | Valor-Touched | Ability | **passive** |
| 8 | Full Surge | Ability | text |
| 8 | Ground Pound | Ability | **action** |
| 9 | Hold the Line | Ability | text |
| 9 | Lead by Example | Ability | **reaction** |
| 10 | Unbreakable | Ability | **reaction** |
| 10 | Unyielding Armor | Ability | **reaction** |
