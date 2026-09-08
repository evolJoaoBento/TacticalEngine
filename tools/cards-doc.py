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
out.append("- **Breaking Blow** leaves its crack for the holder's own next hit: nothing raises a party member's blow to the rest of the party, so an ally's swing does not cash the mark. **Rapid Riposte** hits back with the primary weapon rather than a choice of active ones.")
out.append("- **Battle Monster** throws the damage roll away and marks the Hit Points the caster is carrying, past thresholds, resistance and Armor Slots - which is what \"instead of rolling for damage\" asks for.")
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
