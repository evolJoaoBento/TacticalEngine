/**
 * The Store as the Rust server must keep it (`docs/SERVER.md`, phase 1): this runs `tools/store.ts` -
 * and the import `tools/your-models.ts` does for its Get - over every judgement it makes, and holds
 * the answers to `server/fixtures/store.json`, which `server/serve/tests/golden_store.rs` replays.
 * Files are hex; the listings file is the same file on both sides. `UPDATE_GOLDEN=1 npx vitest run
 * tests/unit/store.golden.test.ts` writes the fixture afresh.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LISTINGS_FILE, MOST_PROOFS, authenticity, castVote, decode, engineListingId, engineListings, judgeListingId, judgePublish, judgeSale, judgeUpdate, judgeVote,
  markOf, readListings, sniff, supported, titleOf, viewOf, type Listing,
} from '../../tools/store';
import { freeModelId, tidyId, type YourModel } from '../../tools/your-models';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../../server/fixtures/store.json');

const hex = (bytes: Uint8Array | null): string | null => (bytes === null ? null : Buffer.from(bytes).toString('hex'));
const b64 = (bytes: number[]): string => Buffer.from(bytes).toString('base64');
const GLB = [0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 9];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPG = [0xff, 0xd8, 0xff, 0xe0, 1];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1];

/** The drafts a judgement hands back, bytes as hex, so they compare as JSON. */
function plain(value: unknown): unknown {
  if (value instanceof Uint8Array) return { hex: hex(value) };
  if (Array.isArray(value)) return value.map(plain);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, plain(inner)]));
  return value;
}

function listing(over: Partial<Listing> = {}): Listing {
  return {
    id: '0123456789abcdef', title: 'Stone Golem', description: '', claim: 'human-made', forSale: false, how: 'Sculpted in Blender.', kind: 'model',
    file: '0123456789abcdef-asset.glb', fileName: 'golem.glb', proofs: ['0123456789abcdef-proof-0.png'], creator: 'ash', creatorName: 'Ash', created: 1, votes: {},
    ...over,
  };
}

const DECODES = [
  b64(GLB), `data:model/gltf-binary;base64,${b64(GLB)}`, 'Z2xURg', 'Z2xURg=', 'Z2x URg==', 'Z2x\nURg==', 'Z2x$URg==', '-_-_', '+/+/', 'Z2xURg==Z2xURg==', 'a',
  'ab', 'abc', '', '====', 'data:,', 'no,comma,twice', 'éééé', 12, null,
];

const T = (length: number): string => 'x'.repeat(length);
const PUBLISHES: unknown[] = [
  { title: ' Stone Golem ', description: 'A golem.', claim: 'ai-assisted', forSale: true, how: 'Blender; AI drafted the texture.', asset: { name: 'golem.glb', data: `data:model/gltf-binary;base64,${b64(GLB)}` }, proofs: [{ name: 'a.png', data: b64(PNG) }, { data: b64(JPG) }, { data: b64(WEBP) }] },
  { title: 'Golem', asset: { name: 'golem.glb', data: b64(GLB) } },
  { title: 'Golem', claim: 'human-made', asset: { name: 'Gö lem!!(1).GLB', data: b64(GLB) } },
  { title: 'Golem', asset: { name: '!!!', data: b64(PNG) } },
  { title: 'Golem', asset: { name: 42, data: b64(PNG) } },
  { title: 'Golem', asset: { name: `${T(90)}.png`, data: b64(PNG) } },
  { title: '', asset: { name: 'a.png', data: b64(PNG) } },
  { title: '   ', asset: { name: 'a.png', data: b64(PNG) } },
  { title: T(80), asset: { name: 'a.png', data: b64(PNG) } },
  { title: T(81), asset: { name: 'a.png', data: b64(PNG) } },
  { title: `  ${T(80)} ﻿`, asset: { name: 'a.png', data: b64(PNG) } },
  { title: '\u0085Golem', asset: { name: 'a.png', data: b64(PNG) } },
  { title: '🎲'.repeat(40), asset: { name: 'a.png', data: b64(PNG) } },
  { title: '🎲'.repeat(41), asset: { name: 'a.png', data: b64(PNG) } },
  { title: 5, asset: { name: 'a.png', data: b64(PNG) } },
  { title: 'Long', how: T(2001), asset: { name: 'a.png', data: b64(PNG) } },
  { title: 'Long', description: T(2000), how: T(2000), asset: { name: 'a.png', data: b64(PNG) } },
  { title: 'Nulls', description: null, how: null, claim: null, asset: { name: 'a.png', data: b64(PNG) } },
  { title: 'Numbers', description: 3, asset: { name: 'a.png', data: b64(PNG) } },
  { title: 'Robot', claim: 'robot', asset: { name: 'a.png', data: b64(PNG) } },
  { title: 'Virus', asset: { name: 'a.exe', data: b64([0x4d, 0x5a, 0x90, 0]) } },
  { title: 'No asset' },
  { title: 'String asset', asset: 'Z2xURg==' },
  { title: 'Proof not a picture', asset: { name: 'a.png', data: b64(PNG) }, proofs: [{ data: b64(GLB) }] },
  { title: 'Proof not a list', asset: { name: 'a.png', data: b64(PNG) }, proofs: { data: b64(PNG) } },
  { title: 'Proof null', asset: { name: 'a.png', data: b64(PNG) }, proofs: null },
  { title: 'Proof of null', asset: { name: 'a.png', data: b64(PNG) }, proofs: [null] },
  { title: 'Too many', asset: { name: 'a.png', data: b64(PNG) }, proofs: Array.from({ length: MOST_PROOFS + 1 }, () => ({ data: b64(PNG) })) },
  { title: 'Sale unshown', claim: 'human-made', forSale: true, asset: { name: 'a.png', data: b64(PNG) } },
  { title: 'Sale no how', claim: 'human-made', forSale: true, how: '  ', asset: { name: 'a.png', data: b64(PNG) }, proofs: [{ data: b64(PNG) }] },
  { title: 'Sale AI', claim: 'ai-generated', forSale: true, how: 'prompt', asset: { name: 'a.png', data: b64(PNG) }, proofs: [{ data: b64(PNG) }] },
  { title: 'Sale default claim', forSale: true, how: 'x', asset: { name: 'a.png', data: b64(PNG) }, proofs: [{ data: b64(PNG) }] },
  { title: 'Sale truthy', forSale: 'yes', asset: { name: 'a.png', data: b64(PNG) } },
  ['Golem'],
  7,
];
const PUBLISH_TEXTS = [...PUBLISHES.map((body) => JSON.stringify(body)), 'not json', ''];

const HAS: Record<string, number> = { '0123456789abcdef': 2, fedcba9876543210: 6 };
const UPDATES: unknown[] = [
  { id: '0123456789abcdef', how: ' Blender. ', claim: 'ai-assisted', forSale: true, addProofs: [{ name: 's.png', data: b64(PNG) }] },
  { id: '0123456789abcdef', how: 'x' },
  { id: '0123456789abcdef' },
  { id: '0123456789abcdef', how: null },
  { id: '0123456789abcdef', how: 3 },
  { id: '0123456789abcdef', how: T(2001) },
  { id: '0123456789abcdef', claim: 'robot' },
  { id: '0123456789abcdef', claim: null },
  { id: '0123456789abcdef', forSale: null },
  { id: '0123456789abcdef', forSale: 'true' },
  { id: '0123456789abcdef', addProofs: Array.from({ length: 4 }, () => ({ data: b64(PNG) })) },
  { id: '0123456789abcdef', addProofs: Array.from({ length: 5 }, () => ({ data: b64(PNG) })) },
  { id: 'fedcba9876543210', addProofs: [{ data: b64(PNG) }] },
  { id: 'fedcba9876543210', addProofs: [] },
  { id: '0123456789abcdef', addProofs: [{ data: b64(GLB) }] },
  { id: '0123456789abcdef', addProofs: 'nope' },
  { id: '1111111111111111', how: 'x' },
  { id: '0123456789ABCDEF', how: 'x' },
  { id: '../../etc', how: 'x' },
  { id: 5 },
  {},
  [],
];
const UPDATE_TEXTS = [...UPDATES.map((body) => JSON.stringify(body)), 'not json'];

const VOTES = [
  { id: '0123456789abcdef', vote: 'like' }, { id: '0123456789abcdef', vote: 'dislike' }, { id: '0123456789abcdef', vote: null }, { id: '0123456789abcdef' },
  { id: '0123456789abcdef', vote: 'love' }, { id: '0123456789ABCDEF', vote: 'like' }, { id: 'x', vote: 'like' }, { vote: 'like' }, [], 'string',
];
const VOTE_TEXTS = [...VOTES.map((body) => JSON.stringify(body)), 'null', 'not json'];
const IDS = [{ id: '0123456789abcdef' }, { id: 'nope' }, { id: 7 }, {}, [], 3];
const ID_TEXTS = [...IDS.map((body) => JSON.stringify(body)), 'null', 'not json'];

/** Views: counts, the asker's own, the mark, whether it is in theirs; never who voted or the file names. */
const VIEWS: { listing: Listing; asker: string | null; yours: string[] }[] = [
  { listing: listing({ votes: { bramble: 'like', quim: 'like', violet: 'dislike' } }), asker: 'violet', yours: [] },
  { listing: listing({ votes: { a: 'like', b: 'like' } }), asker: 'ash', yours: ['0123456789abcdef'] },
  { listing: listing({ proofs: [] }), asker: null, yours: [] },
  { listing: listing({ how: '  ', claim: 'ai-assisted' }), asker: 'bramble', yours: [] },
  { listing: listing({ votes: { a: 'like', b: 'dislike', c: 'dislike' } }), asker: 'a', yours: [] },
  { listing: listing({ votes: { a: 'like', b: 'like', c: 'dislike', d: 'dislike', e: 'dislike', f: 'dislike', g: 'dislike', h: 'dislike' } }), asker: null, yours: [] },
  { listing: { ...listing(), engine: true, created: 1790000000123.4567 }, asker: 'bramble', yours: ['0123456789abcdef'] },
];

const ENGINE_FILES = [{ file: 'bandit-cutter.glb', created: 5 }, { file: 'Arty.glb', created: 6.25 }, { file: 'Female Tortle.glb', created: 1790000000123.4567 }];
const PROVENANCE = { 'model:arty': 'ai-assisted', 'model:female-tortle': 'human-made', 'model:bandit-cutter': 'nonsense' };

function castVotes() {
  const target = listing();
  const unshown = listing({ proofs: [] });
  const steps: [Listing, string, 'like' | 'dislike' | null][] = [
    [target, 'bramble', 'like'], [target, 'bramble', 'dislike'], [target, 'quim', 'like'], [target, 'bramble', null], [target, 'ash', 'like'], [target, 'nobody', null],
    [unshown, 'bramble', 'like'], [unshown, 'bramble', null],
  ];
  return steps.map(([on, voter, vote]) => ({ on: on === target ? 'target' : 'unshown', voter, vote, refused: castVote(on, voter, vote), votes: { ...on.votes } }));
}

function migrations() {
  const root = mkdtempSync(join(tmpdir(), 'store-golden-'));
  try {
    const { claim: _c, forSale: _f, proofs: _p, ...old } = listing();
    const raw = [{ ...old, proof: 'x-proof.png' }, { ...old, id: 'fedcba9876543210', proof: null }, { ...old, id: '1111111111111111' }, listing({ id: '2222222222222222', claim: 'ai-assisted', forSale: true }), { ...listing({ id: '3333333333333333' }), extra: { kept: 1 } }];
    mkdirSync(dirname(join(root, LISTINGS_FILE)), { recursive: true });
    const cases = [JSON.stringify(raw), '{"not":"a list"}', 'not json'];
    return cases.map((file) => {
      writeFileSync(join(root, LISTINGS_FILE), file);
      return { file, listings: readListings(root) };
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function golden() {
  return {
    about: 'tools/store.ts and the import tools/your-models.ts does for Get, run for the Rust port; written by tests/unit/store.golden.test.ts',
    mostProofs: MOST_PROOFS,
    sniff: [GLB, PNG, JPG, WEBP, [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45], [0x67, 0x6c, 0x54], [], [0x4d, 0x5a]].map((bytes) => ({ bytes, sniffed: sniff(new Uint8Array(bytes)) })),
    decode: DECODES.map((value) => ({ value, bytes: hex(decode(value)) })),
    publish: PUBLISH_TEXTS.map((body) => ({ body, verdict: plain(judgePublish(body)) })),
    has: HAS,
    update: UPDATE_TEXTS.map((body) => ({ body, verdict: plain(judgeUpdate(body, (id) => HAS[id] ?? null)) })),
    vote: VOTE_TEXTS.map((body) => ({ body, verdict: judgeVote(body) })),
    listingId: ID_TEXTS.map((body) => ({ body, verdict: judgeListingId(body) })),
    authenticity: [[45, 3], [1, 0], [0, 2], [0, 0], [2, 1], [1, 2], [1, 7], [5, 3], [1, 199], [199, 1]].map(([likes, dislikes]) => ({ likes, dislikes, authenticity: authenticity(likes!, dislikes!) })),
    marks: VIEWS.map(({ listing }) => ({ listing, supported: supported(listing), mark: markOf(listing), sale: judgeSale({ ...listing, forSale: true }) })),
    views: VIEWS.map(({ listing, asker, yours }) => ({ listing, asker, yours, view: viewOf(listing, asker, new Set(yours)) })),
    castVotes: castVotes(),
    engine: {
      files: ENGINE_FILES,
      provenance: PROVENANCE,
      fromNothing: engineListings([], ENGINE_FILES, PROVENANCE),
      keptAndGone: (() => {
        const first = engineListings([listing()], ENGINE_FILES, PROVENANCE).listings;
        first[1]!.votes = { bramble: 'like' };
        return { before: first, after: engineListings(first, ENGINE_FILES.slice(1), PROVENANCE), same: engineListings(first, ENGINE_FILES, PROVENANCE).changed };
      })(),
      ids: ENGINE_FILES.map(({ file }) => [file, engineListingId(file), titleOf(file)]),
    },
    migrations: migrations(),
    // A listings file as the TypeScript writes it - timestamps with fractions, as file times are - which
    // the Rust server must read and write back to the byte.
    listingsFile: `${JSON.stringify(
      [1790247235275.4915, 1790247235936.3381, 1790462790485.5073, 1790247243894.6243, 1790247252933.0405, 1790634656101, 0.1, 1790000000000.5].map((created, i) =>
        ({ ...listing({ id: `${i}`.repeat(16), votes: i % 2 === 0 ? { a: 'like' } : {} }), created, ...(i === 3 ? { engine: true } : {}) })),
      null,
      2,
    )}
`,
    tidyId: ['Stone_Golem.glb', 'golem.GLTF', '--.glb', 'Female Tortle.glb', 'İstanbul.glb', 'Æther Wing.glb', 'a..b', '', 'model.glb.glb'].map((name) => [name, tidyId(name)]),
    freeModelId: [
      { wanted: 'golem', taken: ['golem', 'golem-2'], free: freeModelId('golem', [{ id: 'golem' }, { id: 'golem-2' }] as YourModel[]) },
      { wanted: 'wolf', taken: ['golem'], free: freeModelId('wolf', [{ id: 'golem' }] as YourModel[]) },
      { wanted: 'golem', taken: ['golem', 'golem-3'], free: freeModelId('golem', [{ id: 'golem' }, { id: 'golem-3' }] as YourModel[]) },
    ],
  };
}

describe('the Store, as the Rust server must keep it', () => {
  it('is what server/fixtures/store.json holds', () => {
    const now = JSON.parse(JSON.stringify(golden())) as unknown;
    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(now, null, 1)}\n`, 'utf8');
    }
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(now);
  });
});
