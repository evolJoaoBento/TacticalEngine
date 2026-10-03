/**
 * Write the SRD's character content as a pack the repository ships:
 * `src/engine/content/pack/shipped/srd-characters.json`, bundled so a project can list it by name.
 *
 *   node tools/ship-srd-characters.mjs [<content.json> <abilities.json>]
 *
 * Reads the two files the catalogue was once exported as (`packs/srd.json` and
 * `packs/srd-abilities.json`, git-ignored, by default) through the engine's own `readPack` - loaded
 * with Vite, so it is the same reader Import pack uses, migrations and all - and keeps what a
 * character is made of: classes, subclasses, ancestries, communities and every card (the domain
 * cards a player chooses, and the features the rest print, each a card granted by what printed it),
 * with the abilities, conditions and scripts those cards run. Weapons and armour stay out - the
 * equipment catalogue has them, with their cards - and so do the adversaries, which nothing asked for.
 *
 * The user chose to ship this on 26 September 2026: SRD Public Game Content under the DPCGL, text
 * only, attributed in docs/CONTEXT.md. Nothing here is art.
 */

import { writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [contentPath = join(root, 'packs', 'srd.json'), mechanicsPath = join(root, 'packs', 'srd-abilities.json')] = process.argv.slice(2);

const server = await createServer({ root, logLevel: 'error', server: { middlewareMode: true }, appType: 'custom' });
try {
  const { readPack, describePack } = await server.ssrLoadModule('/src/engine/content/pack/document.ts');
  const content = readPack(JSON.parse(readFileSync(contentPath, 'utf8')), contentPath);
  const mechanics = readPack(JSON.parse(readFileSync(mechanicsPath, 'utf8')), mechanicsPath);
  const issues = [...content.issues, ...mechanics.issues];
  if (issues.length > 0) throw new Error(`the export does not read cleanly: ${issues.map((i) => i.message).join('; ')}`);

  // One card per id: where both files have it, the mechanics file's is the one its abilities were
  // written against - with the content file's printed text where its own is blank, since the
  // mechanics file built some of its cards from abilities that printed nothing.
  const cards = new Map();
  for (const card of [...content.pack.cards, ...mechanics.pack.cards]) {
    if (card.grant.kind === 'adversary') continue;
    const printed = cards.get(card.id);
    const blank = card.text === '' && card.features.length === 0;
    cards.set(card.id, printed !== undefined && blank ? { ...card, text: printed.text, features: printed.features } : card);
  }
  const unprinted = [...cards.values()].filter((card) => card.text === '' && card.features.length === 0).map((card) => card.id);
  if (unprinted.length > 0) console.warn(`cards with no printed text in either file: ${unprinted.join(', ')}`);
  const abilities = mechanics.pack.abilities.filter((ability) => ability.source?.card === undefined || cards.has(ability.source.card));
  const pack = {
    formatVersion: 6,
    classes: content.pack.classes,
    subclasses: content.pack.subclasses,
    ancestries: content.pack.ancestries,
    communities: content.pack.communities,
    cards: [...cards.values()],
    abilities,
    conditionDefs: mechanics.pack.conditionDefs,
    code: mechanics.pack.code,
  };
  const again = readPack(JSON.parse(JSON.stringify(pack)), 'srd-characters');
  if (again.issues.length > 0) throw new Error(`what was written does not read back: ${again.issues.map((i) => i.message).join('; ')}`);
  const out = join(root, 'src', 'engine', 'content', 'pack', 'shipped', 'srd-characters.json');
  writeFileSync(out, `${JSON.stringify(pack, null, 1)}\n`);
  console.log(`${out}: ${describePack(again.pack)}`);
} finally {
  await server.close();
}
