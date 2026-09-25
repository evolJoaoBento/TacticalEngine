/**
 * Bring the models down from where they live.
 *
 *   npm run models            fetch whatever is missing or not what the list says
 *   npm run models -- --check say what is missing or wrong, and fetch nothing
 *
 * The .glb files are not in the git repository - every version of a model ever committed stays in
 * every clone for good, and they were most of its weight - so they live in a Hugging Face repo, and
 * `models.lock.json` at the root of this one says which: the repo, the exact revision, and every
 * file with its size and SHA-256. This downloads each file into `public/models/`, the folder the
 * game reads them from (`tools/model-manifest.ts`), and checks it against the list; a file already
 * there and already right is left alone, so running it again costs nothing.
 *
 * Nothing else changes for the game: once the files are in `public/models/`, the dev server, the
 * tests and a build find them exactly where they always were.
 *
 * The equipment cards' pictures come down the same way, from the same repo: `equipment.lock.json`
 * names them under `equipment/`, and they land in `public/equipment/`.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');

/** Each list, and the folder its paths are read from: a model's path is its file name, a card's `equipment/<file>`. */
const LISTS = [
  { lock: 'models.lock.json', folder: join(root, 'public', 'models') },
  { lock: 'equipment.lock.json', folder: join(root, 'public') },
];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

let fetched = 0;
let wrong = 0;
let total = 0;
for (const list of LISTS) {
  const lock = JSON.parse(readFileSync(join(root, list.lock), 'utf8'));
  const url = (file) => `https://huggingface.co/${lock.repoType === 'dataset' ? 'datasets/' : ''}${lock.repo}/resolve/${lock.revision}/${file.split('/').map(encodeURIComponent).join('/')}`;
  total += lock.files.length;
  for (const entry of lock.files) {
    const path = join(list.folder, entry.path);
    if (existsSync(path)) {
      const bytes = readFileSync(path);
      if (bytes.length === entry.bytes && sha256(bytes) === entry.sha256) continue;
      console.log(`${entry.path}: not the file the list names${checkOnly ? '' : ' - fetching it again'}`);
    } else console.log(`${entry.path}: missing${checkOnly ? '' : ' - fetching'}`);
    wrong++;
    if (checkOnly) continue;
    const response = await fetch(url(entry.path));
    if (!response.ok) throw new Error(`${entry.path}: ${response.status} ${response.statusText} from ${url(entry.path)}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) throw new Error(`${entry.path}: what came down is not what the list names (${bytes.length} bytes)`);
    // Written beside and moved in, so a download cut short never leaves half a file behind.
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.part`, bytes);
    renameSync(`${path}.part`, path);
    fetched++;
  }
}
if (checkOnly) {
  console.log(wrong === 0 ? `all ${total} models and card pictures present and correct` : `${wrong} of ${total} models and card pictures missing or wrong: run npm run models`);
  process.exit(wrong === 0 ? 0 : 1);
}
console.log(fetched === 0 ? `all ${total} models and card pictures already here` : `fetched ${fetched} of ${total} models and card pictures from Hugging Face`);
