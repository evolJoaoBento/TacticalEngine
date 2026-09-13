// List the card art in `public/cards/` and write `public/cards/index.json`.
//
// This downloads nothing. It looks at the files you put in the directory and
// writes down what is there, so the app can show a card's picture without
// guessing at a URL and logging a 404 for every card that has none.
//
// Drop `power-slash.jpg` in `public/cards/`, run this, and Power Slash wears it.
// A file whose name does not match a card is still indexed under its own stem,
// and named in the report, so a typo is visible rather than silent.
//
// The card list comes from `packs/srd.json` when one has been exported. Without it the files are
// still indexed; nothing can be said about which of them name a real card.
//
//   node tools/index-card-art.mjs
import fs from 'node:fs/promises';
import path from 'node:path';

const DIRECTORY = 'public/cards';
const INDEX = path.join(DIRECTORY, 'index.json');
const IMAGES = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']);

/** The same normalisation the card ids use: lowercase, no punctuation. */
const idOf = (name) =>
  name.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// The cards to match against come from an exported content pack. `packs/` is git-ignored, so
// on a fresh clone there is none -- and the directory listing is the real job, so a missing
// pack means "match nothing" rather than "do nothing".
const PACK = 'packs/srd.json';
let known = new Set();
try {
  const pack = JSON.parse(await fs.readFile(PACK, 'utf8'));
  known = new Set((pack.domainCards ?? []).map((card) => idOf(card.name)));
} catch {
  console.log(`No ${PACK}; indexing the directory without matching against any card list.`);
}

let entries;
try {
  entries = await fs.readdir(DIRECTORY, { withFileTypes: true });
} catch {
  console.log(`No ${DIRECTORY}/ directory. Nothing to index; every card draws its own emblem.`);
  process.exit(0);
}

const index = {};
const unmatched = [];
for (const entry of entries) {
  if (!entry.isFile()) continue;
  const extension = path.extname(entry.name);
  if (!IMAGES.has(extension.toLowerCase())) continue;
  const id = idOf(path.basename(entry.name, extension));
  index[id] = entry.name;
  if (!known.has(id)) unmatched.push(entry.name);
}

const ordered = Object.fromEntries(Object.entries(index).sort(([a], [b]) => a.localeCompare(b)));
await fs.writeFile(INDEX, JSON.stringify(ordered, null, 2) + '\n');

const matched = Object.keys(ordered).length - unmatched.length;
console.log(`Indexed ${Object.keys(ordered).length} file(s) in ${DIRECTORY}/.`);
if (known.size === 0) {
  console.log(`${matched} indexed without a card list to match against.`);
} else {
  console.log(`${matched} match a domain card; ${known.size - matched} card(s) will draw their own emblem.`);
}
if (unmatched.length > 0) {
  console.log(`\nNot a known card id, indexed under their own name:`);
  for (const name of unmatched.slice(0, 20)) console.log(`  ${name}`);
  if (unmatched.length > 20) console.log(`  ...and ${unmatched.length - 20} more`);
}
