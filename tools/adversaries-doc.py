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
out.append('- **a summon** — another creature onto the map mid-fight, which no effect can place.')
out.append('- **a Countdown** — a clock that ticks on a trigger and goes off later.')
out.append('- **spotlighting allies** — a feature that hands the turn to other adversaries.')
out.append('- **a point on the map** — "choose a point within Far range; everyone within Close range')
out.append('  of *that*": selectors read bands around the creature that is acting, not around a spot.')
out.append('- **a token on the stat block**, a transformation into another block, flight, teleporting,')
out.append('  or ground that stays dangerous after the feature ends.')
out.append('- **a rider on a number the script cannot see** — "for each target who marked HP", "if')
out.append('  they used armor", "equal to the HP they marked", "up to three targets".')
out.append('- **a condition the SRD prints once** — Entranced, Poisoned, Cursed, Deathlock and the')
out.append('  rest: written into that one block rather than into the rules.')
out.append('- **a social beat** — a bargain, a rumour, a scapegoat: a scene rather than a grid.')
out.append('- **a passive on a number the engine does not have** — "reduce the damage by 1d10"')
out.append('  (reduction is not a typed defence), "deal 1d6+5 instead of their standard damage when')
out.append('  another Wolf is in Melee range" (a damage swap on a condition), "when this adversary')
out.append('  is attacked, the attacker marks a Stress" (a rider on *being* attacked, which is the')
out.append('  other side of the two triggers the swing already carries).')
out.append('- **an ally on the other side** — the GM\'s turn aims a feature at the party, so a')
out.append('  feature that shields or heals one of its own has no way to be pointed at it.\n')
out.append('Facing is *not* a reason: "in front of the Burrower" is read as the whole band, as Spit')
out.append('Acid has been from the start. Nor is resistance — a passive that halves or ignores a')
out.append('damage type is a `defenses` line, and neither is a rider that follows the swing the')
out.append('block already prints, which is a reaction to `dealtHit` or `dealtDamage`.' + chr(10))
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
