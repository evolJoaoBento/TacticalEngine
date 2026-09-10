// List the card art in `public/cards/` and write `public/cards/index.json`.
//
// This downloads nothing. It looks at the files you put in the directory and
// writes down what is there, so the app can show a card's picture without
// guessing at a URL and logging a 404 for every card that has none.
//
// Drop `bare-bones.jpg` in `public/cards/`, run this, and Bare Bones wears it.
// A file whose name does not match a card is still indexed under its own stem,
// and named in the report, so a typo is visible rather than silent.
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

const data = JSON.parse(
  await fs.readFile('tools/srd-sources/daggersearch/core/domain-cards.json', 'utf8'),
);
const known = new Set(
  (Array.isArray(data) ? data : Object.values(data)).map((card) => idOf(card.name['en-US'])),
);

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
  const extension = path.extname(entry.name).toLowerCase();
  if (!IMAGES.has(extension)) continue;
  const id = idOf(path.basename(entry.name, extension));
  index[id] = entry.name;
  if (!known.has(id)) unmatched.push(entry.name);
}

const ordered = Object.fromEntries(Object.entries(index).sort(([a], [b]) => a.localeCompare(b)));
await fs.writeFile(INDEX, JSON.stringify(ordered, null, 2) + '\n');

const matched = Object.keys(ordered).length - unmatched.length;
console.log(`Indexed ${Object.keys(ordered).length} file(s) in ${DIRECTORY}/.`);
console.log(`${matched} match a domain card; ${known.size - matched} card(s) will draw their own emblem.`);
if (unmatched.length > 0) {
  console.log(`\nNot a known card id, indexed under their own name:`);
  for (const name of unmatched.slice(0, 20)) console.log(`  ${name}`);
  if (unmatched.length > 20) console.log(`  ...and ${unmatched.length - 20} more`);
}
