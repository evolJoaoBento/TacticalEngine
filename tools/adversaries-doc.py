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
out.append(f"Read: {counts['read']}. Scripted: {counts['scripted']}. Text: {counts['text']}.\n")
out.append('| Adversary | Feature | Kind | Engine |')
out.append('|---|---|---|---|')
for name, feature, kind, state, note in rows:
    out.append(f'| {name} | {feature.split(" - ")[0]} | {kind or "—"} | **{state}** — {note} |')
io.open(root + 'docs/ADVERSARIES.md', 'w', encoding='utf-8', newline='\n').write('\n'.join(out) + '\n')
print('features', len(rows), dict(counts))
