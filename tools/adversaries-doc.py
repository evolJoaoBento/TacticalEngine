"""Write docs/ADVERSARIES.md: every stat-block feature, and what the engine does with it.

Run from the repo root: `python tools/adversaries-doc.py`. It reads the
vendored adversary list, the role features the engine reads off a block
(`src/engine/combat/adversary-features.ts`) and the scripted ones
(`src/engine/content/srd/adversary-abilities.ts`), so the doc cannot claim
more than the code does.
"""
import io, json, os, re, collections

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + '/'
adversaries = json.load(io.open(root + 'tools/srd-sources/seansbox/adversaries.json', encoding='utf-8'))
features_src = io.open(root + 'src/engine/combat/adversary-features.ts', encoding='utf-8').read()
scripted_src = io.open(root + 'src/engine/content/srd/adversary-abilities.ts', encoding='utf-8').read()

# The role features the engine reads off a block, from the one list that decides it.
implemented = re.search(r"IMPLEMENTED_FEATURES: readonly string\[\] = \[([^\]]*)\]", features_src).group(1)
implemented = {name.strip().strip("'") for name in implemented.split(',') if name.strip()}

# The features scripted as abilities: name, and which adversaries have them.
scripted = {}
for block in re.finditer(r"\{\s*id: '([^']+)',\s*name: '([^']+)',\s*source: from\(([^)]*)\)", scripted_src):
    who = [w.strip().strip("'") for w in block.group(3).split(',') if w.strip()]
    for adversary in who:
        scripted.setdefault(adversary, set()).add(block.group(2))


def kebab(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower().replace("'", '')).strip('-')


def base(name):
    return name.split('(')[0].split(' - ')[0].strip()


rows = []
counts = collections.Counter()
for entry in adversaries:
    aid = kebab(entry['name'])
    for feature in entry.get('feature', []):
        label = base(feature['name'])
        kind = feature['name'].split(' - ')[-1].strip() if ' - ' in feature['name'] else ''
        if label in scripted.get(aid, set()):
            state, note = 'scripted', 'runs as an ability'
        elif label.lower() in implemented:
            state, note = 'read', 'read off the stat block'
        else:
            state, note = 'text', "the GM's to play"
        counts[state] += 1
        rows.append((entry['name'], feature['name'], kind, state, note))

out = []
out.append('# Adversary features: what the engine runs\n')
out.append('Every feature printed on an adversary in the vendored stat blocks, and what this engine')
out.append('does with it. Three states:\n')
out.append('- **read** — a rule the fight obeys, read straight off the block')
out.append('  (`src/engine/combat/adversary-features.ts`): Relentless, Horde, Minion, Momentum, Terrifying.')
out.append('- **scripted** — an ability in the one effect vocabulary')
out.append('  (`src/engine/content/srd/adversary-abilities.ts`), used by the GM on its spotlight.')
out.append('- **text** — printed for the GM to narrate; the engine does nothing with it.\n')
out.append('Why a feature is text, in the order the reasons come up. It asks for something the')
out.append('engine has no place to put:\n')
out.append('- **a summon the block does not name** — "1d4+1 Tier 1 adversaries", "six Tier 3')
out.append('  Minions", "Minions relevant to a personal nightmare": which stat block arrives is the')
out.append('  GM to pick, and an engine that picked one would be writing the encounter. The ones')
out.append('  that name what they call are scripted.')
out.append('- **a countdown whose trigger or payoff the vocabulary cannot say** - the clock itself')
out.append('  runs (`src/engine/rules/countdown.ts`), so the ones that arm on a spotlight, tick on a')
out.append('  roll and then damage, summon or apply a condition are scripted. What stays text is the')
out.append('  payoff: a charge in a straight line through everyone, a circle of ground that stays')
out.append('  dangerous, allies made to attack, a clock somebody else winds. Two are the other way')
out.append('  round - the Flickerflies say what they do plainly enough, but "takes damage for the')
out.append('  first time" is not a trigger anything raises: the defence step answers damage with')
out.append('  shapes, not with a script.')
out.append('- **a spotlight nothing can aim** - a Leader handing the GM turn to its own side runs')
out.append('  (a `spotlight` effect, paid for by the feature that said so), so what stays text is the')
out.append("  aiming: allies chosen by what they could reach without moving,")
out.append("  a creature the block counts as one of its own, an extra spotlight for the one acting.")
out.append('- **a point on the map** — "choose a point within Far range; everyone within Close range')
out.append('  of *that*": selectors read bands around the creature that is acting, not around a spot.')
out.append('- **a rule about a third creature** - counting them runs. The selectors could already')
out.append('  say which creatures and where (around the target rather than the actor, off the same')
out.append('  stat block, everyone but the one asking); `nearby` is the question nothing could put')
out.append('  to them, which is how many. So both Pack Tactics read "another one of us is within')
out.append('  Melee range of the target", and the Vampire finds a follower to feed on. An ability')
out.append('  can also say what makes a creature worth aiming at (`target.when`, read once for each')
out.append('  candidate), which is what keeps the Swarm from spending a Stress crushing somebody')
out.append('  who is carrying no brambles.')
out.append("  What stays text is a rule that moves somebody else's dice: \"disadvantage on attacks")
out.append("  against targets other than the Swarm\", \"the next time the Taunted target attacks\".")
out.append('  A passive can move the dice for its holder or against them (`advantage`, with')
out.append('  `against`) and that is two parties; a third is not something a modifier can name.')
out.append("  Nor is a trigger about what another creature did - a Turret answering somebody")
out.append("  else's damage roll, a Shark answering somebody else's hit.")
out.append('- **a token nobody else can count** - tokens run, on a stat block as well as on a card.')
out.append('  The store is keyed by creature and card, so a passive keeps a count on itself (Slow')
out.append('  is one `spotlighted` reaction branching on its own tokens, placing one on the turn it')
out.append('  gathers and spending it on the turn it acts, with `endSpotlight` paying for the wait)')
out.append("  or hangs one on somebody else (the Swarm's brambles, which Restrain whoever carries")
out.append('  them and come off when the Swarm takes Major damage). What stays text is the asking:')
out.append('  a roll a PC makes on their own turn to tear free, an action aimed at whoever is')
out.append('  carrying three of them - the GM takes the nearest creature in reach, not the one a')
out.append('  feature would rather have - and ground that stays dangerous after the feature ends.')
out.append('- **a path rather than a destination** - a creature crossing the ground runs (`move`,')
out.append('  towards somebody or away from them, as far as the band it names allows), so what')
out.append('  stays text is the line it draws on the way: "move to a point within Close range and')
out.append('  deal damage to all targets in their path". A destination and a band around it is')
out.append('  scripted - the Dive-Bomb lands and hits everyone within Very Close of where it landed.')
out.append('  So is a walk on the way in or out of a swing; what is not is an interrupt before the')
out.append('  roll ("when a creature moves into Melee range to make an attack"), and the passives')
out.append('  about flight, stone and shadows, which are about where a creature may go rather than')
out.append('  about it going there.')
out.append('- **a number the blow does not carry** - how much of a wound landed is now read: an')
out.append('  amount can be written as a count (`hitPointsTaken`, `hitPointsDealt`, `targetsHit`)')
out.append('  and a feature can be gated on one, which is what "when the Brawler marks 2 or more')
out.append('  HP" was waiting for. Damage sent back is `dice: \'same\'`, which keeps the blow\'s own')
out.append('  dice and type. What stays text is every other number: one the block keeps rather than')
out.append('  the blow (handfuls of gold, the Assassin\'s unmarked Stress), one spent per target')
out.append('  rather than in total ("lose a number of Hope equal to the HP they marked"), dice')
out.append('  rolled one per Hit Point, and a Fear cost that is a number rather than a price - the')
out.append('  vocabulary gains Fear and never spends it.')
out.append('- **a condition the SRD prints once** — Entranced, Poisoned, Cursed, Deathlock and the')
out.append('  rest: written into that one block rather than into the rules.')
out.append('- **a social beat** — a bargain, a rumour, a scapegoat: a scene rather than a grid.')
out.append('- **an offer to the player** - "they can choose to reroll their Fear Die". What the room')
out.append('  makes of a roll the party made now runs (`partyRolled`, with a `rolled` gate reading')
out.append('  what the dice said and the one who rolled bound as the target), so what stays here is')
out.append('  a feature that hands the player a decision, and a roll made in conversation.')
out.append('- **a swap whose condition nothing can ask** - a passive can change what the block\'s own')
out.append('  teeth do to this target ("1d10+4 instead of their standard damage" while Hidden,')
out.append('  "double damage to PCs with 0 Hope"), read from the attacker\'s chair with the target')
out.append('  bound. What stays text is the asking: standing above somebody, a roll that had')
out.append('  advantage, and a third creature beside the target ("another Wolf within Melee range')
out.append('  of the target").')
out.append('  A rider on *being* attacked now runs - a swing raises `attacked` on whoever it was')
out.append('  aimed at, hit or miss, and the Swashbucklers gate on how little the blow marked.')
out.append('- **an ally on the other side** — the GM\'s turn aims a feature at the party, so a')
out.append('  feature that shields or heals one of its own has no way to be pointed at it.\n')
out.append('Facing is *not* a reason: "in front of the Burrower" is read as the whole band, as Spit')
out.append('Acid has been from the start. Nor is a summons that names its block: "summon three')
out.append('Jagged Knife Lackeys, who appear at Far range" is a `summon` effect, and they are in')
out.append('the fight from the moment they are standing there. Nor is a swarm: "spotlight all')
out.append('Giant Rats within Close range of them" is a `joinedBy` on the attack the feature')
out.append('makes, and the rest of the kind walk in and swing with it. Nor is resistance — a passive that halves or ignores a')
out.append('damage type is a `defenses` line, and so is one that takes a number off the total')
out.append('before the thresholds are read ("reduce it by 3", "reduce it by 1d10"). Neither is a')
out.append('rider that follows the swing the block already prints, which is a reaction to')
out.append('`dealtHit` or `dealtDamage`.' + chr(10))
out.append('A scripted feature says as much of its text as the vocabulary carries; where it says')
out.append('less, the entry in `adversary-abilities.ts` carries a line saying what was left out.')
out.append("The text shown at the table is the block's own, printed as written, so when a script")
out.append('departs from it rather than merely doing less, what the engine actually does is in the')
out.append("condition it applies: the Oak Treant's Rooted halves physical damage and does not hold")
out.append('it still, because a creature this engine holds still spends its next turn tearing free.' + chr(10))
out.append(f"Read: {counts['read']}. Scripted: {counts['scripted']}. Text: {counts['text']}.\n")
out.append('| Adversary | Feature | Kind | Engine |')
out.append('|---|---|---|---|')
for name, feature, kind, state, note in rows:
    out.append(f'| {name} | {feature.split(" - ")[0]} | {kind or "—"} | **{state}** — {note} |')
io.open(root + 'docs/ADVERSARIES.md', 'w', encoding='utf-8', newline='\n').write('\n'.join(out) + '\n')
print('features', len(rows), dict(counts))
