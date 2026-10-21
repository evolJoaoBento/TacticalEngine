/**
 * How the engine's art was made, and the default project, as the Rust server must keep them
 * (`docs/SERVER.md`, phase 1): this runs `tools/art-provenance.ts` and `tools/default-project.ts` over
 * files, changes and saves, and holds the answers to `server/fixtures/art-and-project.json`, which
 * `server/serve/tests/golden_art_and_project.rs` replays - the marks file to the byte, its keys in
 * `localeCompare`'s order. `UPDATE_GOLDEN=1 npx vitest run tests/unit/art-provenance.golden.test.ts`
 * writes the fixture afresh.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROVENANCE_FILE, judgeProvenance, markProvenance, readProvenance, writeProvenance, type Provenance, type ProvenanceMap, type ProvenanceRequest } from '../../tools/art-provenance';
import { judgeSave, type SaveRequest } from '../../tools/default-project';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../../server/fixtures/art-and-project.json');

const MARK_FILES = [
  JSON.stringify({ 'model:arty': 'ai-assisted', 'card:bare-bones': 'human-made', 'equipment:broadsword.webp': 'ai-generated' }),
  JSON.stringify({ 'model:arty': 'robot', 'Model:arty': 'human-made', 'model:': 'human-made', 'model:-x': 'human-made', 'model:a b': 'human-made', 'card:ok_1.two-3': 'human-made', 'equipment:x': null }),
  JSON.stringify({ [`model:${'a'.repeat(128)}`]: 'human-made', [`model:${'a'.repeat(129)}`]: 'human-made' }),
  '["model:arty"]', 'null', 'not json', '',
];

/** Marks given and taken back, in order, the file written after each: keys that sort differently by locale than by byte. */
const CHANGES: [string, Provenance | null][] = [
  ['model:arty', 'ai-assisted'], ['model:Arty', 'human-made'], ['model:apple', 'ai-generated'], ['model:Zed', 'human-made'], ['model:zed', 'human-made'], ['model:b', 'human-made'],
  ['model:a_b', 'human-made'], ['model:a-b', 'human-made'], ['model:a.b', 'human-made'], ['model:a:b', 'human-made'], ['model:a1', 'human-made'], ['model:a10', 'human-made'], ['model:a2', 'human-made'],
  ['model:A', 'human-made'], ['model:a', 'human-made'], ['model:aA', 'human-made'], ['model:Aa', 'human-made'], ['model:AA', 'human-made'], ['model:aa', 'human-made'],
  ['card:bare-bones', 'human-made'], ['equipment:broadsword.webp', 'ai-generated'], ['equipment:Broad_sword.webp', 'ai-generated'], ['card:9lives', 'human-made'], ['card:_under', 'human-made'],
  ['model:Arty', null], ['model:nobody', null], ['model:arty', 'human-made'],
];

const PAGE: Record<string, string> = { 'x-tactical-save': '1', origin: 'http://127.0.0.1:8420', host: '127.0.0.1:8420' };
const REQUESTS: { method: string; headers: Record<string, string> }[] = [
  { method: 'POST', headers: PAGE },
  { method: 'GET', headers: PAGE },
  { method: 'POST', headers: { origin: PAGE['origin']!, host: PAGE['host']! } },
  { method: 'POST', headers: { ...PAGE, origin: 'https://elsewhere.example' } },
];
const MARK_BODIES = [
  { key: 'model:arty', provenance: 'human-made' }, { key: 'model:arty', provenance: null }, { key: 'model:arty' }, { key: 'model:arty', provenance: 'robot' },
  { key: 'thing:arty', provenance: 'human-made' }, { key: 'model:', provenance: 'human-made' }, { key: 5, provenance: 'human-made' }, [], 5, null,
].map((body) => JSON.stringify(body));

const SAVES = [
  JSON.stringify({ id: 'p', scenes: [{ id: 'hall' }] }),
  `${JSON.stringify({ id: 'p', scenes: [{ id: 'hall' }] }, null, 2)}\n`,
  JSON.stringify({ id: 'p', scenes: [] }),
  JSON.stringify({ id: 5, scenes: [{}] }),
  JSON.stringify({ scenes: [{}] }),
  JSON.stringify({ id: 'p', scenes: {} }),
  JSON.stringify([{ id: 'p', scenes: [{}] }]),
  'null', '"text"', 'not json', '',
  '{"id":"p","scenes":[{}]}\r\n',
  '{"id":"é","scenes":[{}]}',
];

function golden() {
  const root = mkdtempSync(join(tmpdir(), 'art-golden-'));
  try {
    mkdirSync(dirname(join(root, PROVENANCE_FILE)), { recursive: true });
    const files = MARK_FILES.map((text) => {
      writeFileSync(join(root, PROVENANCE_FILE), text);
      return { text, read: readProvenance(root) };
    });
    rmSync(join(root, PROVENANCE_FILE), { force: true });
    let map: ProvenanceMap = readProvenance(root);
    const changes = CHANGES.map(([key, provenance]) => {
      map = markProvenance(map, key, provenance);
      writeProvenance(root, map);
      return { key, provenance, file: readFileSync(join(root, PROVENANCE_FILE), 'utf8') };
    });
    return {
      about: 'tools/art-provenance.ts and tools/default-project.ts run for the Rust port; written by tests/unit/art-provenance.golden.test.ts',
      files,
      changes,
      marks: REQUESTS.flatMap((request) => MARK_BODIES.map((body) => ({ ...request, body, verdict: judgeProvenance(request as ProvenanceRequest, body) }))),
      saves: REQUESTS.flatMap((request) => SAVES.map((body) => ({ ...request, body, verdict: judgeSave(request as SaveRequest, body) }))),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('the art marks and the default project, as the Rust server must keep them', () => {
  it('are what server/fixtures/art-and-project.json holds', () => {
    const now = JSON.parse(JSON.stringify(golden())) as unknown;
    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(now, null, 1)}\n`, 'utf8');
    }
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(now);
  });
});
