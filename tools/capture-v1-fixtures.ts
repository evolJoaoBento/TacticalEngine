/**
 * Capture real version-1 documents, while version 1 is still what the code writes.
 *
 * Slice 4 renames two persisted pool names (`hope`, `fear`) and bumps `formatVersion` to 2 with a
 * load-time migration. The migration has to be proved against a **genuine** version-1 document, and
 * there is exactly one window in which one can be produced: now, before the rename. Afterwards any
 * "version 1 fixture" would be something hand-written to match the migration it is supposed to
 * test, which proves the migration agrees with itself and nothing else.
 *
 * So this writes two files into `tests/fixtures/v1/`, committed as data:
 *
 *   project.json  the demo project as `projectSchema` parses it — `formatVersion: 1`, and every
 *                 ability, condition and sheet the demo carries.
 *   save.json     a save taken after the party has acted, so the snapshots are not pristine:
 *                 `scenes[*].fear` and `scenes[*].entities[*].hope` are the fields the migration
 *                 has to find, and they only appear with real values once something has happened.
 *
 * Run from the repo root:
 *
 *     npx tsx tools/capture-v1-fixtures.ts
 *
 * It is expected to stop working after slice 4 lands. That is the point — it captures a format the
 * code no longer writes, and the fixtures it produced outlive it.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { demoMap } from '../legacy/js/data.js';
import { buildDemoScene } from '../src/game/demo-scene';
import { projectSchema } from '../src/engine/scene/schema';
import { saveGame } from '../src/game/save';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}tests/fixtures/v1`;
mkdirSync(out, { recursive: true });

const demo = buildDemoScene(demoMap(), 'v1-fixture');

// The project, exactly as the schema writes it today.
const project = projectSchema.parse(demo.project);
writeFileSync(`${out}/project.json`, `${JSON.stringify(project, null, 2)}\n`, 'utf8');

// A save wants state worth migrating. Spend a Hope and mark the scene's Fear so both pools carry a
// non-default value: a save of an untouched room would let a migration pass by doing nothing.
const kara = demo.state.entity('kara');
if (kara?.hope !== undefined) kara.hope = { value: 4, max: kara.hope.max };
demo.state.fear = { value: 3, max: demo.state.fear.max };

const save = saveGame(demo);
if (save === null) throw new Error('the demo refused to save; a fixture cannot be captured from it');
writeFileSync(`${out}/save.json`, `${JSON.stringify(save, null, 2)}\n`, 'utf8');

const rooms = Object.keys(save.scenes);
const pools = rooms.map((id) => {
  const room = save.scenes[id]!;
  const held = Object.values(room.entities).filter((entity) => entity.hope !== undefined).length;
  return `${id}: fear ${room.fear.value}/${room.fear.max}, ${held} entit${held === 1 ? 'y' : 'ies'} with hope`;
});

console.log(`tests/fixtures/v1/project.json: formatVersion ${project.formatVersion}, ${project.scenes.length} scenes, ${project.abilities.length} abilities`);
console.log(`tests/fixtures/v1/save.json: formatVersion ${save.formatVersion}, ${rooms.length} room(s)`);
for (const line of pools) console.log(`  ${line}`);
