/**
 * Write `models.lock.json`: which Hugging Face repo and revision the models come from, and every
 * .glb in `public/models/` with its size and SHA-256.
 *
 *   node tools/lock-models.mjs <owner/repo> <revision>
 *
 * Run after uploading the folder (`hf upload <owner/repo> public/models . --include "*.glb"`), with
 * the revision the upload made, so the list names exactly the files that are there. `npm run models`
 * (`tools/fetch-models.mjs`) reads it back. The originals kept in `public/models/heavy/` are not
 * models the game loads, and are not listed.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [repo, revision] = process.argv.slice(2);
if (repo === undefined || revision === undefined || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[0-9a-f]{40}$/.test(revision)) {
  console.error('usage: node tools/lock-models.mjs <owner/repo> <40-character revision>');
  process.exit(1);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const folder = join(root, 'public', 'models');
const files = readdirSync(folder, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(glb|gltf)$/i.test(entry.name))
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b))
  .map((path) => {
    const bytes = readFileSync(join(folder, path));
    return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
const lock = { repo, repoType: 'model', revision, files };
writeFileSync(join(root, 'models.lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
console.log(`models.lock.json: ${files.length} models, ${(files.reduce((sum, f) => sum + f.bytes, 0) / 1e6).toFixed(1)} MB, ${repo}@${revision.slice(0, 8)}`);
