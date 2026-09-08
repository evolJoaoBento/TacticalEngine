# Domain cards: what the engine runs

Every SRD domain card is held, shown and counted toward the loadout. The ones marked here
as **action**, **reaction** or **passive** are scripted in `src/engine/content/srd/abilities.ts`
and run through the one effect vocabulary; the rest are **text**: the card's words are shown on
the action bar and the table adjudicates, as at a real one. A grimoire lists each spell.

Known simplifications in the scripted ones:

- **Rune Ward** never breaks on an 8; **Get Back Up**, **Iron Will**, **Brace**, **Shrug It Off**, **On the Brink** and the ward fire on their own when they lower the Hit Points marked (per-card `auto`, and an interrupt is always asked).
- **Arcane Barrage**, **Unleash Chaos**, **Falling Sky** and **Wild Flame** offer a short list of amounts rather than any number.
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
- Cards that ask for a Presence Roll to compel, a Countdown, Hidden/Cloaked, flight, teleportation, a summon, or a GM's discretion stay text.

Scripted: 62 of 189 cards.


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
| 4 | Blink Out | Spell | text |
| 4 | Preservation Blast | Spell | **action** |
| 5 | Chain Lightning | Spell | **action** |
| 5 | Premonition | Spell | text |
| 6 | Rift Walker | Spell | text |
| 6 | Telekinesis | Spell | text |
| 7 | Arcana-Touched | Ability | **passive** |
| 7 | Cloaking Blast | Spell | text |
| 8 | Arcane Reflection | Spell | text |
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
| 3 | Scramble | Ability | text |
| 3 | Versatile Fighter | Ability | text |
| 4 | Deadly Focus | Ability | text |
| 4 | Fortified Armor | Ability | **passive** |
| 5 | Champion's Edge | Ability | text |
| 5 | Vitality | Ability | text |
| 6 | Battle-Hardened | Ability | text |
| 6 | Rage Up | Ability | text |
| 7 | Blade-Touched | Ability | **passive** |
| 7 | Glancing Blow | Ability | text |
| 8 | Battle Cry | Ability | text |
| 8 | Frenzy | Ability | text |
| 9 | Gore and Glory | Ability | text |
| 9 | Reaper's Strike | Ability | text |
| 10 | Battle Monster | Ability | text |
| 10 | Onslaught | Ability | text |

## Bone

| Level | Card | Type | Engine |
|---|---|---|---|
| 1 | Deft Maneuvers | Ability | text |
| 1 | I See It Coming | Ability | text |
| 1 | Untouchable | Ability | **text** |
| 2 | Ferocity | Ability | **reaction**, **passive** |
| 2 | Strategic Approach | Ability | text |
| 3 | Brace | Ability | **reaction** |
| 3 | Tactician | Ability | text |
| 4 | Boost | Ability | text |
| 4 | Redirect | Ability | text |
| 5 | Know Thy Enemy | Ability | text |
| 5 | Signature Move | Ability | text |
| 6 | Rapid Riposte | Ability | text |
| 6 | Recovery | Ability | text |
| 7 | Bone-Touched | Ability | text |
| 7 | Cruel Precision | Ability | **passive** |
| 8 | Breaking Blow | Ability | text |
| 8 | Wrangle | Ability | text |
| 9 | On the Brink | Ability | **reaction** |
| 9 | Splintering Strike | Ability | text |
| 10 | Deathrun | Ability | text |
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
| 6 | Sigil of Retribution | Spell | text |
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
| 5 | Words of Discord | Spell | text |
| 6 | Never Upstaged | Ability | **reaction**, **passive** |
| 6 | Share the Burden | Spell | text |
| 7 | Endless Charisma | Ability | text |
| 7 | Grace-Touched | Ability | text |
| 8 | Astral Projection | Spell | text |
| 8 | Mass Enrapture | Spell | **action** |
| 9 | Copycat | Spell | text |
| 9 | Master of the Craft | Ability | text |
| 10 | Encore | Spell | text |
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
| 8 | Spellcharge | Spell | text |
| 9 | Night Terror | Spell | text |
| 9 | Twilight Toll | Ability | text |
| 10 | Eclipse | Spell | text |
| 10 | Specter of the Dark | Spell | text |

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
| 5 | Thorn Skin | Spell | text |
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
| 5 | Smite | Spell | text |
| 6 | Restoration | Spell | **action** |
| 6 | Zone of Protection | Spell | text |
| 7 | Healing Strike | Spell | **reaction** |
| 7 | Splendor-Touched | Ability | **passive** |
| 8 | Shield Aura | Spell | text |
| 8 | Stunning Sunlight | Spell | **action** |
| 9 | Overwhelming Aura | Spell | text |
| 9 | Salvation Beam | Spell | text |
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
| 3 | Critical Inspiration | Ability | text |
| 3 | Lean on Me | Ability | text |
| 4 | Goad Them On | Ability | text |
| 4 | Support Tank | Ability | text |
| 5 | Armorer | Ability | **passive** |
| 5 | Rousing Strike | Ability | text |
| 6 | Inevitable | Ability | text |
| 6 | Rise Up | Ability | **passive**, **reaction** |
| 7 | Shrug It Off | Ability | **reaction** |
| 7 | Valor-Touched | Ability | **passive** |
| 8 | Full Surge | Ability | text |
| 8 | Ground Pound | Ability | **action** |
| 9 | Hold the Line | Ability | text |
| 9 | Lead by Example | Ability | text |
| 10 | Unbreakable | Ability | text |
| 10 | Unyielding Armor | Ability | text |
