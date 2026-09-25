/**
 * Write `equipment.lock.json` for the card pictures just published.
 *
 *   node tools/lock-equipment.mjs <revision>
 *
 * After `tools/loot-cards.mjs` has written `public/equipment/*.webp` and they have been uploaded
 * to the models' Hugging Face repo under `equipment/`, this names every one by size and SHA-256 at
 * the revision the upload made, so `npm run models` fetches exactly those and checks them - the
 * same list `models.lock.json` is for the models.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [revision] = process.argv.slice(2);
if (revision === undefined || !/^[0-9a-f]{40}$/.test(revision)) {
  console.error('usage: node tools/lock-equipment.mjs <the 40-character revision the upload made>');
  process.exit(1);
}
const models = JSON.parse(readFileSync(join(root, 'models.lock.json'), 'utf8'));
const folder = join(root, 'public', 'equipment');
const files = readdirSync(folder)
  .filter((name) => name.endsWith('.webp'))
  .sort()
  .map((name) => {
    const bytes = readFileSync(join(folder, name));
    return { path: `equipment/${name}`, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
writeFileSync(join(root, 'equipment.lock.json'), `${JSON.stringify({ repo: models.repo, repoType: models.repoType, revision, files }, null, 2)}\n`);
console.log(`equipment.lock.json: ${files.length} pictures at ${models.repo}@${revision.slice(0, 8)}`);
