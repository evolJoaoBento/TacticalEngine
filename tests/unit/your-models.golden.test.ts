/**
 * Your models as the Rust server must keep them (`docs/SERVER.md`, phase 1): this runs
 * `tools/your-models.ts` over served urls, import bodies and a folder filled in order, and holds the
 * answers to `server/fixtures/your-models.json`, which `server/serve/tests/golden_your_models.rs`
 * replays - the index file to the byte. `UPDATE_GOLDEN=1 npx vitest run
 * tests/unit/your-models.golden.test.ts` writes the fixture afresh.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileOfUrl, importModel, judgeImport, readYourModels } from '../../tools/your-models';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../../server/fixtures/your-models.json');
const GLB = (n: number): number[] => [0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, n];
const b64 = (bytes: number[]): string => Buffer.from(bytes).toString('base64');
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const URLS = [
  '/__models/u/bramble/imported/golem.glb', '/__models/u/rt-a/imported/golem-2.glb', '/__models/u/under_score/imported/a1-b2-c3.glb',
  '/__models/u/bramble/imported/../../accounts.json', '/__models/u/../imported/golem.glb', '/__models/u/bramble/imported/golem.gltf',
  '/__models/u/bramble/imported/Golem.glb', '/__models/u/bramble/imported/golem-.glb', '/__models/u/bramble/imported/-golem.glb',
  '/__models/u/Bramble/imported/golem.glb', '/__models/u/ab/imported/golem.glb', `/__models/u/${'a'.repeat(25)}/imported/golem.glb`,
  '/__models/u/bramble/imported/golem.glb?x=1', '/__models/u/bramble/imported/', '/__models/u/bramble/golem.glb', '/models/golem.glb', '',
];

const IMPORTS = [
  { name: 'g.glb', data: `data:model/gltf-binary;base64,${b64(GLB(1))}` }, { name: 'g.glb', data: b64(GLB(1)) }, { name: 'g.glb', data: 'Z2x URg==' },
  { url: '/__models/u/violet/imported/wolf.glb' }, { url: '/etc/passwd' }, { url: 5, name: 'g.glb', data: b64(GLB(1)) }, { url: null, name: 'g.glb', data: b64(GLB(1)) },
  { name: 'g.glb' }, { data: b64(GLB(1)) }, { name: 3, data: b64(GLB(1)) }, {}, [], 'text', 7,
];
const IMPORT_TEXTS = [...IMPORTS.map((body) => JSON.stringify(body)), 'not json', ''];

/** A folder filled in order: new files, the same file again, a name taken by another, one got from the Store, and refusals. */
const STEPS: { account: string; name: string; bytes: number[]; listing?: string }[] = [
  { account: 'bramble', name: 'Stone Golem.glb', bytes: GLB(1) },
  { account: 'bramble', name: 'another-name.glb', bytes: GLB(1), listing: '0123456789abcdef' },
  { account: 'bramble', name: 'Stone Golem.glb', bytes: GLB(2) },
  { account: 'bramble', name: 'stone_golem.GLB', bytes: GLB(3), listing: 'fedcba9876543210' },
  { account: 'bramble', name: 'x.glb', bytes: GLB(3), listing: '1111111111111111' },
  { account: 'bramble', name: '!!!.glb', bytes: GLB(4) },
  { account: 'bramble', name: 'picture.png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { account: '../etc', name: 'a.glb', bytes: GLB(5) },
  { account: 'Bramble', name: 'a.glb', bytes: GLB(5) },
  { account: 'violet', name: 'Stone Golem.glb', bytes: GLB(2) },
];

function folder() {
  const root = mkdtempSync(join(tmpdir(), 'your-models-golden-'));
  try {
    const steps = STEPS.map(({ account, name, bytes, listing }) => {
      const made = importModel(root, account, name, new Uint8Array(bytes), listing === undefined ? {} : { listing });
      if (!made.ok) return { account, name, bytes, listing: listing ?? null, refused: made.reason };
      const { added: _added, ...model } = made.model;
      return { account, name, bytes, listing: listing ?? null, model, fresh: made.fresh };
    });
    const files = ['bramble', 'violet'].map((account) => ({ account, models: readYourModels(root, account).map(({ added: _added, ...model }) => model) }));
    // An index as the TypeScript writes it, which the Rust server must read and write back to the byte.
    const index = join(root, 'data/users/bramble/models/imported.json');
    return { steps, files, indexFile: readFileSync(index, 'utf8') };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function golden() {
  return {
    about: 'tools/your-models.ts run for the Rust port; written by tests/unit/your-models.golden.test.ts',
    fileOfUrl: URLS.map((url) => ({ url, named: fileOfUrl(url) })),
    import: IMPORT_TEXTS.map((body) => {
      const verdict = judgeImport(body);
      return { body, verdict: verdict.ok && 'bytes' in verdict ? { ok: true, name: verdict.name, hex: hex(verdict.bytes) } : verdict };
    }),
    folder: folder(),
  };
}

describe('your models, as the Rust server must keep them', () => {
  // The index holds when each model came: a clock that stands still, so the fixture is the same each run.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_790_000_000_000);
  });
  afterEach(() => vi.useRealTimers());

  it('are what server/fixtures/your-models.json holds', () => {
    const now = JSON.parse(JSON.stringify(golden())) as unknown;
    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(now, null, 1)}\n`, 'utf8');
    }
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(now);
  });
});
