/**
 * The models manifest as the Rust server must keep it (`docs/SERVER.md`, phase 1): this runs
 * `tools/model-manifest.ts` over file names, ancestry files, changes and uploads, and holds the answers to
 * `server/fixtures/model-manifest.json`, which `server/serve/tests/golden_manifest.rs` replays - the
 * ancestries file to the byte. `UPDATE_GOLDEN=1 npx vitest run tests/unit/model-manifest.golden.test.ts`
 * writes the fixture afresh.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANCESTRY_FILE, MODELS_DIRECTORY, assignAncestry, judgeAncestry, judgeModelAdd, modelIdOf, readModelAncestries, shippedModels, writeModelAncestries,
  type AncestryRequest, type ModelAncestries,
} from '../../tools/model-manifest';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../../server/fixtures/model-manifest.json');
const GLB = [0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0];
const hex = (bytes: number[]): string => Buffer.from(bytes).toString('hex');

const NAMES = ['Stone Golem.glb', 'stone_golem.GLTF', 'Quim.glb', 'quim.GLB', '--.glb', 'Female Tortle.glb', 'İstanbul.glb', 'Æther Wing.glb', 'a..b.glb', '.glb', '', 'no-extension', 'model.glb.glb', 'x.gltf.glb', '日本.glb'];

const ANCESTRY_FILES = [
  JSON.stringify({ quim: 'dwarf', arty: 'halfling', 'female-tortle': 'galapa' }),
  JSON.stringify({ quim: 'dwarf', 'Bad Id': 'elf', arty: 5, ganja: 'Giant', violet: 'elf', '-x': 'elf', scarlet: null }),
  JSON.stringify(['quim', 'dwarf']),
  'null', '"text"', 'not json', '',
];

/** Ancestries given and taken away, in order, the file written after each: its keys sorted as localeCompare sorts. */
const CHANGES: [string, string | null][] = [
  ['quim', 'dwarf'], ['arty', 'halfling'], ['ab', 'elf'], ['a-b', 'elf'], ['a', 'orc'], ['a1', 'orc'], ['a-1', 'orc'], ['zz', 'ribbet'], ['quim', 'human'], ['arty', null], ['nobody', null],
];

const PAGE: Record<string, string> = { 'x-tactical-save': '1', origin: 'http://127.0.0.1:8420', host: '127.0.0.1:8420' };
const REQUESTS: { method: string; headers: Record<string, string> }[] = [
  { method: 'POST', headers: PAGE },
  { method: 'GET', headers: PAGE },
  { method: 'PUT', headers: PAGE },
  { method: 'POST', headers: { origin: PAGE['origin']!, host: PAGE['host']! } },
  { method: 'POST', headers: { ...PAGE, origin: 'https://elsewhere.example' } },
  { method: 'POST', headers: { 'x-tactical-save': '1' } },
];
const ANCESTRY_BODIES = [
  { model: 'quim', ancestry: 'dwarf' }, { model: 'quim', ancestry: null }, { model: 'quim' }, { model: 'Quim', ancestry: 'dwarf' }, { model: 'quim', ancestry: 'Dwarf' },
  { model: 'quim', ancestry: 5 }, { model: 5, ancestry: 'dwarf' }, { ancestry: 'dwarf' }, { model: '-quim', ancestry: 'dwarf' }, { model: 'a--b', ancestry: 'dwarf' }, [], 5, null,
].map((body) => JSON.stringify(body));

const UPLOADS: { name: string | null; bytes: number[] }[] = [
  { name: 'Stone Golem.glb', bytes: GLB }, { name: 'fox.GLB', bytes: GLB }, { name: 'Quim.glb', bytes: GLB }, { name: 'quim.glb', bytes: GLB },
  { name: 'fox.gltf', bytes: GLB }, { name: 'fox', bytes: GLB }, { name: null, bytes: GLB }, { name: '--.glb', bytes: GLB }, { name: 'fox.glb', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { name: 'fox.glb', bytes: [0x67, 0x6c, 0x54] }, { name: 'fox.glb', bytes: [] },
];
const TAKEN = ['quim', 'arty'];

const FOLDER = ['Quim.glb', 'arty.glb', 'Arty2.GLB', 'banner-prop.glb', 'Female Tortle.glb', 'notes.txt', 'Zed.gltf', 'éclair.glb', 'b.glb', 'B.glb'];

function judged(verdict: ReturnType<typeof judgeAncestry> | ReturnType<typeof judgeModelAdd>) {
  return verdict;
}

function golden() {
  const root = mkdtempSync(join(tmpdir(), 'manifest-golden-'));
  try {
    const files = ANCESTRY_FILES.map((text) => {
      mkdirSync(dirname(join(root, ANCESTRY_FILE)), { recursive: true });
      writeFileSync(join(root, ANCESTRY_FILE), text);
      return { text, read: readModelAncestries(root) };
    });
    rmSync(join(root, ANCESTRY_FILE), { force: true });
    let map: ModelAncestries = readModelAncestries(root);
    const changes = CHANGES.map(([model, ancestry]) => {
      map = assignAncestry(map, model, ancestry);
      writeModelAncestries(root, map);
      return { model, ancestry, file: readFileSync(join(root, ANCESTRY_FILE), 'utf8') };
    });
    const folder = join(root, 'public');
    mkdirSync(join(folder, MODELS_DIRECTORY), { recursive: true });
    for (const name of FOLDER) writeFileSync(join(folder, MODELS_DIRECTORY, name), '');
    return {
      about: 'tools/model-manifest.ts run for the Rust port; written by tests/unit/model-manifest.golden.test.ts',
      modelIdOf: NAMES.map((name) => [name, modelIdOf(name)]),
      files,
      changes,
      ancestry: REQUESTS.flatMap((request) => ANCESTRY_BODIES.map((body) => ({ ...request, body, verdict: judged(judgeAncestry(request as AncestryRequest, body)) }))),
      taken: TAKEN,
      add: REQUESTS.flatMap((request) => UPLOADS.map(({ name, bytes }) => ({ ...request, name, hex: hex(bytes), verdict: judged(judgeModelAdd(request as AncestryRequest, name, new Uint8Array(bytes), (id) => TAKEN.includes(id))) }))),
      folder: FOLDER,
      shipped: shippedModels(folder, { quim: 'dwarf', 'female-tortle': 'galapa', ghost: 'elf' }),
      noFolder: shippedModels(join(root, 'nowhere')),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('the models manifest, as the Rust server must keep it', () => {
  it('is what server/fixtures/model-manifest.json holds', () => {
    const now = JSON.parse(JSON.stringify(golden())) as unknown;
    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(now, null, 1)}\n`, 'utf8');
    }
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(now);
  });
});
