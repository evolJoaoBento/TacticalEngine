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
        elif 'modifiers: [' in seg:
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
out.append("Known simplifications in the scripted ones:\n")
out.append("- **Rune Ward** never breaks on an 8; **Get Back Up**, **Iron Will**, **Brace**, **Shrug It Off**, **On the Brink** and the ward fire on their own when they lower the Hit Points marked (per-card `auto`, and an interrupt is always asked).")
out.append("- **Arcane Barrage**, **Falling Sky** and **Wild Flame** offer a short list of amounts rather than any number; **Unleash Chaos** and **Share the Burden** ask outright, one button per number, up to twelve.")
out.append("- **Slumber**'s sleeper loses its spotlight until damage marks a Hit Point or the GM spends a Fear, which the GM's turn does on its own when there is one.")
out.append("- **Stunning Sunlight** rolls the damage for those who resist as its own roll, because the card prints different dice for it; **Earthquake** and **Ground Pound** roll once and halve that number, as the card asks.")
out.append("- **Cinder Grasp** lights a target On Fire, but the extra damage for acting while alight is the condition's text and the table's to apply. **Chokehold** makes a target Vulnerable without the card's stronger version of it, and **Corrosive Projectile** deals its damage without the standing Corroded penalty.")
out.append("- **Chain Lightning** strikes the first ring; the chain onward from each wounded target is the table's. **Vicious Entangle** binds the one target, not the second bought with a Hope.")
out.append("- **Cruel Precision** adds Finesse rather than the better of Finesse and Agility; **Voice of Reason**'s Proficiency bonus applies wherever Proficiency is read, not to damage alone; **Second Wind** does not branch on Hope, so the ally's share of it is text.")
out.append("- **Inspirational Words** and **Restoration** spend one token at a time. **Fire Flies** is one of Conjure Swarm's two swarms; the beetles that soak a blow are text.")
out.append("- Four of the nine **-Touched** cards carry a bonus the sheet can hold (Arcana, Blade, Splendor, Valor); the rest ask for something the engine has no number for and stay text.")
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
out.append("- **Reassurance** throws both Duality Dice again; **Support Tank** always throws the Fear Die, it being the one anybody would pick. Neither touches the advantage die or the Help dice, which belong to the roll rather than to the hands that threw it. Both answer the party's weapon swing only: a check made through the runner is not held anywhere it could be rerolled.")
out.append("- **Wild Surge**'s die grows on every action roll the engine hears about, which is the party's weapon swings and the rolls a script makes; a roll nothing raises does not feed it.")
out.append("- Cards that ask for a Presence Roll to compel, a Countdown, Hidden/Cloaked, flight, teleportation, a summon, or a GM's discretion stay text.\n")
count_s=sum(1 for e in entries if e[4])
out.append(f"Scripted: {count_s} of {len(entries)} cards.\n")
dom=None
for d,lvl,name,typ,names in entries:
    if d!=dom:
        dom=d; out.append(f"\n## {d}\n"); out.append("| Level | Card | Type | Engine |"); out.append("|---|---|---|---|")
    how = ', '.join(f"**{h}**" + ('' if nm==name else f" ({nm})") for nm,h in names) if names else 'text'
    out.append(f"| {lvl} | {name} | {typ} | {how} |")
io.open(root+'docs/CARDS.md','w',encoding='utf-8',newline='\n').write('\n'.join(out)+'\n')
print('cards', len(entries), 'scripted', count_s)
