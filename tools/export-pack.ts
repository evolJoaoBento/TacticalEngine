/**
 * Write the vendored catalogue out as a content pack, so deleting the sources loses nothing.
 *
 * The engine reads content as a **pack** — one document, validated by `contentPackSchema`, the
 * same shape the starter pack is written in. The vendored catalogue is not that: it is seven
 * daggersearch JSONs in one dialect and a seansbox adversary list in another, each needing its own
 * importer. This turns all of it into one pack file.
 *
 * Run from the repo root:
 *
 *     npx tsx tools/export-pack.ts
 *
 * It writes `packs/srd.json`, which is **gitignored**. That is the point: the catalogue stops
 * being something the repository ships and becomes something a person can import into the editor
 * if they hold the rights to it. Nothing in the build reaches it, and nothing in the suite depends
 * on it — the engine's own tests read the starter pack or a fixture.
 *
 * What comes out is exactly what the engine can express. The importers drop what they cannot
 * parse and report it, so the issue count is printed rather than swallowed: a pack that silently
 * lost half its cards would be worse than no pack.
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { contentPackSchema } from '../src/engine/content/pack/schema';
import { importContentPack } from '../src/engine/content/pack/import';
import { importSeansboxAdversaries, type RawAdversary } from '../src/engine/content/srd/seansbox-adversaries';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string): unknown => JSON.parse(readFileSync(`${root}${path}`, 'utf8'));
const core = (name: string): unknown[] => read(`tools/srd-sources/daggersearch/core/${name}.json`) as unknown[];

const characters = importContentPack({
  weapons: core('weapons'),
  armors: core('armors'),
  classes: core('classes'),
  ancestries: core('ancestries'),
  communities: core('communities'),
  subclasses: core('subclasses'),
  domainCards: core('domain-cards'),
});

const adversaries = importSeansboxAdversaries(read('tools/srd-sources/seansbox/adversaries.json') as RawAdversary[]);

/**
 * Sixteen of the blocks are Minions, whose printed thresholds read "None" — which
 * `parseThresholds` turns into `NO_THRESHOLDS`, an `Infinity` pair. A pack cannot carry that, and
 * `contentPackSchema` says why in so many words: `JSON.stringify` writes `Infinity` as `null`, so
 * "nothing reaches this band" is written as a large number instead.
 *
 * Nothing is lost by it. A Minion is defeated by any damage that marks it, so which severity band
 * a hit falls in never comes up; the sentinel only has to be out of reach. The count is printed
 * rather than passed over, because a pack that quietly reshaped sixteen creatures would be worse
 * than one that refused.
 */
const UNREACHABLE = 999;
let coerced = 0;
const blocks = adversaries.defs.map((def) => {
  const { major, severe } = def.thresholds;
  if (Number.isFinite(major) && Number.isFinite(severe)) return def;
  coerced += 1;
  return {
    ...def,
    thresholds: {
      major: Number.isFinite(major) ? major : UNREACHABLE,
      severe: Number.isFinite(severe) ? severe : UNREACHABLE,
    },
  };
});

/** A pack is arrays, not maps: the maps are how the rules read it, the arrays are how it travels. */
const pack = contentPackSchema.parse({
  weapons: [...characters.content.weapons.values()],
  armors: [...characters.content.armors.values()],
  classes: [...characters.content.classes.values()],
  ancestries: [...characters.content.ancestries.values()],
  communities: [...characters.content.communities.values()],
  subclasses: [...characters.content.subclasses.values()],
  domainCards: [...characters.content.domainCards.values()],
  adversaries: blocks,
});

mkdirSync(`${root}packs`, { recursive: true });
writeFileSync(`${root}packs/srd.json`, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');

const counts = Object.entries(pack)
  .map(([kind, list]) => `${(list as unknown[]).length} ${kind}`)
  .join(', ');
console.log(`packs/srd.json: ${counts}`);
console.log(`issues: ${characters.issues.length} character, ${adversaries.issues.length} adversary`);
for (const issue of [...characters.issues, ...adversaries.issues].slice(0, 10)) {
  console.log(`  ${JSON.stringify(issue)}`);
}
