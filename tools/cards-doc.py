"""Write docs/CARDS.md: every SRD domain card, scripted or text-only.

Run from the repo root: `python tools/cards-doc.py`. It reads the vendored SRD
card list and the scripted library, and rewrites the table so the doc cannot
drift from what the engine actually runs.
"""
import io, json, re
import os
root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))+'/'
cards=json.load(open(root+'tools/srd-sources/daggersearch/core/domain-cards.json',encoding='utf-8'))
lib=io.open(root+'src/engine/content/srd/abilities.ts',encoding='utf-8').read()
def t(x): return x.get('en-US') if isinstance(x,dict) else x
def kebab(name):
    s=name.lower().replace("'","").replace("’","")
    s=re.sub(r'[^a-z0-9]+','-',s).strip('-')
    return s
# ---------------------------------------------------------------------------
# Why each unscripted card is unscripted.
#
# One line per card, in its own words rather than its domain's. Written by
# reading all 189 cards rather than their names: two rounds of that found cards
# the domain-level summaries had written off (Grace's Invisibility, Arcana's
# Telekinesis), so the summaries are gone and this is what replaced them.
#
# The table below refuses to build if a text card is missing from here, which
# is the point: a card can stay text, but not silently.
# ---------------------------------------------------------------------------
WHY = {
  # Asking the GM something, or being told something. No dice to run.
  'divination': "asks the GM a yes-or-no question about the future",
  'final-words': "asks a corpse questions the GM answers",
  'dark-whispers': "opens a channel into somebody's mind and asks the GM about it",
  'thought-delver': "reads thoughts the GM narrates",
  'gifted-tracker': "asks the GM about tracks, then reads on a creature you have tracked before - which nothing here remembers",
  'natures-tongue': "talks to plants and animals, and its second half turns on being in a natural environment",
  'book-of-vyola': "reads a memory the GM narrates; its other spell shares Stress between two creatures at a moment nothing raises",
  'tell-no-lies': "compels the truth, which is a conversation rather than a roll the engine owns",

  # Somewhere else, or seeing somewhere else. The board is one room of tiles.
  'astral-projection': "puts a copy of you somewhere you have been; the board holds one room at a time",
  'through-your-eyes': "sees through somebody else's eyes",
  'sensory-projection': "drops into a vision of a place you have been",
  'floating-eye': "makes an orb you see through",
  'teleport': "goes to a place you have been before, which is not a place the board knows",
  'book-of-homet': "walks through walls and opens a gate to another plane",
  'safe-haven': "summons an interdimensional house to rest in",
  'wall-walk': "walks on walls and ceilings, where the grid has a floor and nothing else",
  'flight': "has a token clock this engine could run and nothing for it to mean, a creature's height not being a thing here; running the clock without the flying would read worse than the card's own words",

  # Being looked at, or not being.
  'uncanny-disguise': "is a disguise, and the advantage it grants is on avoiding scrutiny",
  'mass-disguise': "disguises a crowd; its Countdown would run and the disguise would mean nothing",
  'cloaking-blast': "turns on Cloaked, which is a line of sight the engine does not draw",
  'veil-of-night': "hangs a curtain between two points and hides you behind it; the board aims at one tile, and being seen is not modelled",
  'shadowhunter': "reads on low light, which the engine has no notion of",
  'deft-deceiver': "gives advantage on deceiving somebody, which is not a roll the engine owns",

  # A creature whose whole purpose is to stand near somebody else - the
  # third-creature rule the modifier schema refuses on purpose.
  'natural-familiar': "puts a critter on the board whose only rule is what it stands next to",
  'forest-sprites': "places sprites that buff whoever is near them - a rule about a third creature",
  'conjured-steeds': "conjures mounts, and the board has no notion of riding one",
  'book-of-exota': "interrupts a magical effect nothing raises, and animates a construct whose stat block is the caster's own traits, which `summon` cannot read off anybody",

  # Terrain, objects and building things.
  'plant-dominion': "reshapes the terrain, which is authored rather than rewritten in play",
  'shape-material': "shapes stone or ice into a tool or a door",
  'manifest-wall': "stands a wall between two points and shunts what was in the way; the board aims at one tile",
  'wild-fortress': "grows a dome with its own damage thresholds and Hit Points, which is a creature-shaped thing that is not a creature",

  # Downtime, sessions and the table's own clock.
  'forager': "is a downtime move",
  'recovery': "swaps a short rest's downtime move for a long rest's",
  'soothing-speech': "adds to a Tend to Wounds taken during a short rest",
  'copycat': "borrows a card out of another player's loadout",
  'master-of-the-craft': "adds a permanent bonus to Experiences, which are words on a sheet rather than a number the engine rolls",
  'notorious': "reads on leveraging a reputation, and its other half is the price of drinks",

  # A moment the engine does not raise.
  'counterspell': "interrupts a magical effect, and nothing here announces one",
  'premonition': "rescinds a move already made and its consequences",
  'invigoration': "refreshes a spent once-per-rest feature, and would need a card to name which of somebody's features it meant; the option lists here are written rather than gathered",
  'stealth-expertise': "turns a roll with Fear into a roll with Hope while moving unnoticed. The moment exists and a roll can now say what it was for - what is missing is a roll the engine itself makes about moving unnoticed, there being no stealth in the game to tag",
  'grace-touched': "swaps an Armor Slot for a Stress, and Hit Points for Stress, at moments nothing raises",
  'midnight-touched': "turns the GM's Fear into your Hope at 0 Hope, and adds the Fear Die to damage - two moments nothing raises",
  'tactician': "lends an Experience to somebody else's roll, and rolls a d20 on a Tag Team Roll, which this engine does not have",
  'bone-touched': "gives +1 Agility, which the sheet can hold, and turns a successful attack into a failure for 3 Hope, which is a defence shape the engine picks from a fixed set",
  'transcendent-union': "lets connected creatures choose who marks Stress or Hit Points, at a moment nothing raises",

  # Close enough to name.
  'confusing-aura': "rolls a d6 per layer to decide whether a blow lands at all; a damage reaction here picks from a fixed set of shapes rather than running a script",
  'hush': "silences an area that follows a creature, and a zone here is anchored to a tile; Silenced would also need a condition that stops spellcasting",
  'banish': "rolls a number of d20s and asks the target to beat the highest, which is a reaction roll against a Difficulty the spell itself rolled for",
}

entries=[]
for c in cards:
    cid=kebab(t(c['name']))
    kind='text'
    # which library entries name this card, and how they run
    blocks=[m.start() for m in re.finditer(r"source: card\('%s'\)"%re.escape(cid), lib)]
    names=[]
    for b in blocks:
        seg=lib[lib.rfind('  {\n',0,b):lib.find('\n  },',b)]
        nm=re.search(r"name: (['\"])(.*?)\1", seg).group(2)
        # A card that answers something is a reaction however it says what it
        # does: `reaction: {` is the defence shape, `kind: 'reaction'` a script
        # that runs when the fight raises its trigger.
        if "kind: 'reaction'" in seg or 'reaction: {' in seg:
            how = 'reaction'
        elif 'effects: [' in seg:
            how = 'action'
        elif 'modifiers: [' in seg or 'lift: {' in seg:
            # `lift` is a passive too: it is read where a roll is made rather
            # than played, the same way a modifier is.
            how = 'passive'
        else:
            how = 'text'
        names.append((nm,how))
    # One card, several abilities: a grimoire's pages each have their own name
    # and all belong here, but a card written as a passive and two reactions
    # under one name says each kind once.
    seen=[]
    for pair in names:
        if pair not in seen: seen.append(pair)
    entries.append((c['domain'].title(), c['level'], t(c['name']), c['type'].title(), seen))
entries.sort(key=lambda e:(e[0],e[1],e[2]))
out=[]
out.append("# Domain cards: what the engine runs\n")
out.append("Every SRD domain card is held, shown and counted toward the loadout. The ones marked here")
out.append("as **action**, **reaction** or **passive** are scripted in `src/engine/content/srd/abilities.ts`")
out.append("and run through the one effect vocabulary; the rest are **text**: the card's words are shown on")
out.append("the action bar and the table adjudicates, as at a real one. A grimoire lists each spell.\n")
out.append("Known simplifications in the scripted ones. Why each of the others is *not* scripted is in the tables below, a line per card - written by reading all 189 rather than their names, which is how two rounds of this found cards the domain-level summaries had written off.\n")
out.append("- **Rune Ward** never breaks on an 8; **Get Back Up**, **Iron Will**, **Brace**, **Shrug It Off**, **On the Brink** and the ward fire on their own when they lower the Hit Points marked (per-card `auto`, and an interrupt is always asked).")
out.append("- **Arcane Barrage**, **Falling Sky** and **Wild Flame** offer a short list of amounts rather than any number; **Unleash Chaos** and **Share the Burden** ask outright, one button per number, up to twelve.")
out.append("- **Slumber**'s sleeper loses its spotlight until damage marks a Hit Point or the GM spends a Fear, which the GM's turn does on its own when there is one.")
out.append("- **Stunning Sunlight** rolls the damage for those who resist as its own roll, because the card prints different dice for it; **Earthquake** and **Ground Pound** roll once and halve that number, as the card asks.")
out.append("- **Cinder Grasp** lights a target On Fire, but the extra damage for acting while alight is the condition's text and the table's to apply. **Chokehold** makes a target Vulnerable without the card's stronger version of it, and **Corrosive Projectile** deals its damage without the standing Corroded penalty.")
out.append("- **Chain Lightning** strikes the first ring; the chain onward from each wounded target is the table's. **Vicious Entangle** binds the one target, not the second bought with a Hope.")
out.append("- **Cruel Precision** adds Finesse rather than the better of Finesse and Agility; **Voice of Reason**'s Proficiency bonus applies wherever Proficiency is read, not to damage alone; **Second Wind** does not branch on Hope, so the ally's share of it is text.")
out.append("- **Inspirational Words** and **Restoration** spend one token at a time. **Fire Flies** is one of Conjure Swarm's two swarms; the beetles that soak a blow are text.")
out.append("- Four of the nine **-Touched** cards carry a bonus the sheet can hold (Arcana, Blade, Splendor, Valor); **Codex-Touched** and **Sage-Touched** put a trait behind a roll instead (below); the other three ask for something the engine has no number for and stay text.")
out.append("- **Bold Presence**, **Codex-Touched** and **Sage-Touched** each put a trait behind a roll - Strength on a Presence Roll for a Hope, Proficiency on a Spellcast Roll for a Stress, Agility or Instinct again once per rest - and all three are offered *after* the dice rather than before them, the Rage Up bargain: the price is paid only on a roll that needed it, so they are offered on a failure and nowhere else, a raise being unable to make a critical. A roll now knows which trait it was thrown with (a check's; a weapon swing does not say yet). The halves that stay text: Bold Presence's once-per-rest avoiding of a condition, Codex-Touched's swap out of the vault mid-fight, Sage-Touched's bonus in a natural environment.")
out.append("- **Healing Strike** clears a Hit Point on the nearest ally rather than a chosen one: it answers a swing that has already landed, and what the player is asked is whether to spend the Hope.")
out.append("- **Ferocity** and **Never Upstaged** keep their bonus as tokens on the card, so the Evasion or the damage is whatever the fight put there; Ferocity is spent by the next attack made at its holder, hit or miss.")
out.append("- **Enrapture** and **Mass Enrapture** put the name on the target and let the condition carry it: a creature whose attention is fixed on one person is two Evasion easier to hit, and whom it attacks is still the table's call. **Glyph of Nightfall** is worth a flat two rather than the caster's Knowledge, because a condition carries one number rather than the number of whoever applied it. **Death Grip** offers the pull and the constriction, not the vines catching everyone in between: that is a line across the map, and a selector reads bands around a creature.")
out.append("- **Spellcharge** takes any wound rather than magic damage alone and is not capped at the caster's Spellcast trait; **Twilight Toll** is worth one die rather than growing with every success that rolled no damage. **Sigil of Retribution** holds a die for every blow without the cap of the caster's level, and recasting it moves the sigil while leaving the dice already on the card - the card clears them when they are rolled and nowhere else.")
out.append("- The cards that last are conditions: **Frenzy** lasts the fight rather than \"until there are no more adversaries within sight\"; **Deadly Focus** lasts it too, because nothing tells a condition who it was about; **Battle Cry** reaches Far and its advantage lasts the fight, where the card ends it on a failure with Fear that no card is told about; and **Night Terror**'s Horrified is Vulnerable and nothing else.")
out.append("- **Unyielding Armor** is offered against any blow the defender is asked about rather than at the moment they would mark an Armor Slot, which is a decision they have not made when the question is put, and its step comes after whatever the armor did. **I See It Coming** is asked once the swing has landed rather than as it is aimed, so a blow that was going to miss anyway never costs a Stress.")
out.append("- **Arcane Reflection** answers any blow the defender is asked about rather than magic damage alone, and what it sends back is the number that arrived without the attack's own directness. **Redirect** spends its Stress on the attempt rather than after the dice come up, and turns the blow onto the nearest adversary within Very Close rather than one the player picks.")
out.append("- **Thorn Skin** and **Scramble** answer the blow the defender is asked about, which is a standard attack: damage dealt by a feature's own script arrives without a question, so neither of them hears it. **Scramble** leaves the ground it was standing on but a creature that follows is the table's, and the swing it avoided earns its attacker nothing - no rider, no Momentum.")
out.append("- The four cards that answer a critical each make one choice for everyone rather than asking each person: **Critical Inspiration** and **Rousing Strike** hand the room one answer, **Rousing Strike** reads \"who can see or hear you\" as Far range and clears two Stress rather than 1d4, and **Champion's Edge** asks for its three in the order the card prints them. **Gore and Glory** answers the critical half only - nothing tells the one swinging that what they hit has fallen.")
out.append("- **Rage Up** is asked once per attack rather than twice, and after the swing lands rather than before it is made - which spends its Stress only on a blow that is going to be counted. **Onslaught** floors a blow at the Major band rather than reading the target's own Major threshold as a number, which is the same two Hit Points; its second half answers an area blow that caught its holder as well as an ally.")
out.append("- **Breaking Blow** leaves its crack for the holder's own next hit: nothing raises a party member's blow to the rest of the party, so an ally's swing does not cash the mark. **Rapid Riposte** hits back with the primary weapon rather than a choice of active ones.")
out.append("- **Battle Monster** throws the damage roll away and marks the Hit Points the caster is carrying, past thresholds, resistance and Armor Slots - which is what \"instead of rolling for damage\" asks for.")
out.append("- **Unbreakable** is offered as one of the death move's own options rather than before the question is put, which is what \"instead of making a death move\" comes to; the card goes to the vault afterwards, as it says, and the Recall Cost brings it back.")
out.append("- **Battle-Hardened** is offered inside the death prompt beside Unbreakable, and **Glancing Blow** answers the holder's own miss before the turn is spent - a miss hands the spotlight over, and a question raised after that is one the player answers on somebody else's turn.")
out.append("- **Versatile Fighter** scripts the half that belongs to a swing: the trait swap is a choice made when the sheet is written and stays text, and the die lifted is the lowest of the roll, which is the one anybody would pick. **Reaper's Strike** reads its “which targets it would succeed against” as one roll against every Difficulty the weapon reaches, and the choice among the ones it beat goes to the nearest.")
out.append("- **Boost** treats the ally as a gate rather than a target: nothing is asked of them and nothing happens to them, so the card only has to know one is standing close enough to push off. **Deft Maneuvers** runs to an adversary and ends in Melee of them rather than to a point on the map, because the board picks creatures and not tiles; it is not the character's action, so the attack that follows still is.")
out.append("- **Deathrun** is the first card aimed at the ground rather than at anybody: the player picks a tile, the board shows what the line would go through before the click, and what the run passes is what it hits. Simplified: the ladder of shrinking damage rolls and the order to deal them in is one roll, the same damage to everyone it beat, which is what every other attack against several targets here does; the card's own +1 to Proficiency is kept.")
out.append("- **Goad Them On** leaves the Stress and the disadvantage; whom a goaded creature has to swing at is the GM's, the way Enrapture's is. **Overwhelming Aura** scripts the price on swinging at its bearer and not the Presence swap: a condition carries a number rather than one trait's name copied onto another.")
out.append("- **Wrangle** spends the Hope whenever there is one rather than offering it, treats every ally as a willing one, and blinks what it moves rather than walking it - a creature hauled across the room does not have to find a path. The Close range is on the destination, measured from the caster.")
out.append("- **Reassurance** throws both Duality Dice again; **Support Tank** always throws the Fear Die, it being the one anybody would pick. Neither touches the advantage die or the Help dice, which belong to the roll rather than to the hands that threw it. Both answer any action roll the party makes - a weapon swing, and now a check made through the runner, which stops after its dice whenever somebody is holding a card that answers one.")
out.append("- **Wild Surge**'s die grows on every action roll the engine hears about, which is the party's weapon swings and the rolls a script makes; a roll nothing raises does not feed it.")
out.append("- **Rift Walker** and **Phantom Retreat** are the two cards that remember a place: a mark is a tile kept under the caster's name, and the second cast comes back to it. The rift is one step rather than a door that stays open until the next spell, and a mark is forgotten on a rest - which Phantom Retreat prints - or on leaving the room, a tile meaning nothing in another one.")
out.append("- **Full Surge**'s \"+2 bonus to all of your character traits\" is +2 on every action roll, a trait being the thing you roll; a trait read anywhere that is not a roll does not move. It lasts to the next rest rather than the next long one, there being one rest a condition outlasts.")
out.append("- The **Book of Korvax** runs two of its three spells. Its circle is the first ground that bites: the crossing is the whole of the spell, so standing still in one sets nothing off, and recasting it leaves the people already inside bearing it rather than hitting them twice. **Lift** sets its target down away from the caster rather than anywhere within Close of where they were - there is no way to aim the second half of a spell aimed at a creature - and on ground that can be walked to, so a lift carries nobody over a wall. The Reaction Roll that makes somebody forget the last minute of a conversation stays text.")
out.append("- **Hold the Line** is the second card built on ground that bites, and of the three ways its stance ends only the failure with Fear is scripted: \"until you move\" needs a hook on the holder's own walk that nothing raises, and the GM spending 2 Fear to clear it is the GM's to spend. The stance otherwise stands until the fight ends or the one holding it falls, and the hold it leaves is the ordinary Restrained, shaken off on the creature's next spotlight.")
out.append("- The **Book of Sitil** runs one spell of its three: the echo that lets an ally's next attack reach a second target the same roll would have beaten. The additional target is the nearest other adversary the swing reaches, chosen the way every other automatic pick here is, and the mark is spent whether or not the roll beats them - the attack it was waiting for has been made. Shifting your appearance to avoid recognition and an illusion that holds up until somebody is within Melee of it are both about being looked at, which nothing here models, and stay text.")
out.append("- The remaining Codex grimoires, four of seven with something a fight can use. **Vagras**: Arcane Door is the caster's own blink to the spot they pointed at, the portal closing behind the one creature that went through it; Reveal takes Hidden off whatever its roll beat, creatures being the only thing here that can be magically hidden; Runic Lock stays text. **Grynn**: Arcane Deflection takes a blow four bands down, which is any blow to nothing, and answers only the holder's own skin - a blow aimed at somebody else is answered by standing in front of them, which is a different card; Wall of Flame is a patch of ground around the one point the player picked rather than a line between two, the board aiming at a tile and not at a pair; Time Lock stays text. **Ronin**: Eternal Enervation is Vulnerable at the `permanent` duration, which outlives the scene as the card asks. **Yarrow**: Timejammer stops every adversary within Far rather than literally everyone, a party member frozen out of their own turn being a worse game than the card intends, and it is released by the caster's next attack, hit or miss - which is what \"an action roll that targets another creature\" comes to here.")
out.append("- **Tempest** is three storms behind one roll, and the choice among them is the player's. The Blizzard is whole. The Hurricane's \"choose a direction the wind is blowing; targets can't move against the wind\" is a direction the board cannot hold, so what lands is the damage. The Sandstorm's \"attacks made from beyond Melee range have disadvantage\" is about where the attacker is standing, and a modifier reads from one creature rather than the distance between two - so it makes every attack aimed at them harder, Melee included. All three last the scene rather than \"until the GM spends a Fear\", there being nobody at that end of the table to spend it.")
out.append("- **Force of Nature** runs the +10 and the upkeep, which is the shape of the card: a form that costs a Hope every time it is used, and drops off whoever cannot pay. Absorbing a creature you defeated needs a moment nothing raises on the party's side, and \"you can't be Restrained\" needs a creature immune to a condition, which nothing here can say; both stay text. The Hope is taken after the roll rather than before it, which differs only for a character down to their last one.")
out.append("- **Fane of the Wilds** is the first card to reach a roll *after* it was read. The spend is made rather than asked - the least number of tokens that carries the total over the Difficulty, and none when the roll needs no saving or cannot be saved - because the moment belongs to the runner, which has nobody to ask. Its tokens are the Sage cards in the loadout, the vault being a place a card goes rather than a number to count, and the token it should gain on a critical Sage spell is not there: nothing tells a card which domain the spell that just critted came from.")
out.append("- **Signature Move** is the only card that changes what is thrown rather than what is added to it: a d20 in place of the d12 Hope Die, which raises the floor of the roll and makes a critical rarer, both of which the card is buying deliberately. Declaring the move is a free thing done before rolling rather than folded into an action, the engine having no way to hear \"as part of\" an action that has not happened yet. **Tactician** says the same words about a Tag Team Roll, which this engine does not have, and stays text along with its half about lending an Experience to somebody else's roll.")
out.append("- **Strategic Approach** spends its token *before* the swing rather than during it, which is what keeps all three of its options: advantage has to be declared before the dice, so a card that asked afterwards could only ever have offered two of the three. Its gate - \"the first time you move within Close range of an adversary\" - is not tracked, nothing here remembering that a character walked before they swung; the cost of both is a player who picks their line and then cannot reach anybody, which is a wasted token rather than a wrong rule.")
out.append("- **Know Thy Enemy** leaves the Hope it costs and the Fear it can take. The information is the table's: the engine already shows every number on that list when you look at a creature, but the effect vocabulary cannot read those numbers into a sentence. The Fear is offered rather than taken, a Stress being a real price and \"you can\" the card's own word.")
out.append("- **Invisibility** keeps its die and its clock: attacks against the hidden creature are made with disadvantage, and every action they take spends one of the tokens the caster's Spellcast trait placed. Two simplifications. The tokens sit with the one who is invisible rather than on the caster's card, which is what lets an ally spend them at all; and \"yourself or an ally\" is an ally, because a caster who chose themselves would spend the first token on the Spellcast Roll that cast it. Not being seen except by magical means is the table's.")
out.append("- **Troublemaker** is the first card to roll dice for an *amount* rather than for damage: a number of d4s scaled by Proficiency, and the best single face of them, marked as Stress on whatever the taunt beat.")
out.append("- **Resurrection** is the one card that goes past the veil, so it is the one effect that does: a heal stands somebody up and stops there on purpose, and `revive` undoes the death itself. It is also the only card that can be aimed at somebody who is not standing there. Simplified twice, both about the d6: the card goes to the vault whatever it said, nothing here rolling a die into a gate, and \"can't cast it again for a week\" is a week this engine does not count, so a failure costs the roll and nothing else.")
out.append("- **Telekinesis** is two rolls: the first takes hold and moves them, the second throws them at the next one along. Simplified as Korvax's Lift is - \"anywhere within Far of their original position\" is away from the one lifting them, there being no way to aim the second half of a spell aimed at a creature - and the one thrown takes nothing for the landing, which the card does not give them either.")
out.append("- **Vitality** is the only card that changes what somebody *is* rather than what they can do: two of its three benefits, each a condition at the `permanent` duration, which is the one duration that outlives a scene and a rest. It asks twice and the second question leaves out what the first took.")
out.append("- **Endless Charisma** is the card that needed a roll to know what it was *for*. `tags` had been on a check since the schema was written and nothing had ever read one; a `rollTagged` gate is what makes them worth writing, and the rolls that are persuasion say so now - Troublemaker's taunt, Goad Them On's, and both halves of Words of Discord. Which die goes back in the cup is the Fear Die, always: the same call Support Tank makes, it being the half that decides who holds the spotlight as well as whether the roll lands.")
out.append("- **Disintegration Wave** wanted a way to kill without hitting - no thresholds, no Armor Slot, nothing that answers a wound - and past the veil, so a heal cannot stand them back up. `slay` is that, and the mirror of the `revive` Resurrection needed. The roll is made once and laid against every Difficulty within Far, which is what the card gives the GM to announce, read off the roll instead; slightly generous when the roll beats 18 by a distance. \"Each one you wish to hit\" is all of them - which of a list to spare is a decision with nobody here to make it - and the Stress is one per target either way.")
out.append("- **Adjust Reality** names a roll's total instead of throwing the dice again - the other thing that can be done to a roll already read, and the reason the post-roll moment was worth building twice. Two decisions of the engine's: \"a result of your choice\" is the least that carries the roll over its Difficulty, five Hope not being spent to make a success prettier, so it is only offered on a failure; and the *total* moves while the faces stand, which is what \"the numerical result\" says - whether the roll was with Hope or with Fear, and whether the dice matched, belong to the throw. Unlike Reassurance it answers its holder's own roll as well as an ally's, which is the card's \"you or a willing ally\".")
count_s=sum(1 for e in entries if e[4])
out.append(f"Scripted: {count_s} of {len(entries)} cards.\n")
dom=None
missing=[kebab(t(c['name'])) for c in cards
         if not [m for m in re.finditer(r"source: card\('%s'\)"%re.escape(kebab(t(c['name']))), lib)]
         and kebab(t(c['name'])) not in WHY]
if missing:
    raise SystemExit('a text card with no reason in WHY: ' + ', '.join(missing))
for d,lvl,name,typ,names in entries:
    if d!=dom:
        dom=d; out.append(f"\n## {d}\n"); out.append("| Level | Card | Type | Engine | Why |"); out.append("|---|---|---|---|---|")
    how = ', '.join(f"**{h}**" + ('' if nm==name else f" ({nm})") for nm,h in names) if names else 'text'
    why = '' if names else WHY[kebab(name)]
    out.append(f"| {lvl} | {name} | {typ} | {how} | {why} |")
io.open(root+'docs/CARDS.md','w',encoding='utf-8',newline='\n').write('\n'.join(out)+'\n')
print('cards', len(entries), 'scripted', count_s)
