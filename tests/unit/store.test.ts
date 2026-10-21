import { describe, expect, it } from 'vitest';
import {
  authenticity, castVote, engineListingId, engineListings, judgeListingId, judgePublish, judgeSale, judgeUpdate, judgeVote, markOf, mayGet, mayRemove, readListings, sniff, supported, viewOf,
  titleOf, LISTINGS_FILE, MOST_PROOFS, type Listing,
} from '../../tools/store';
import { hashPassword, type Account } from '../../tools/accounts';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * The store (`tools/store.ts`): show your work - a listing is marked AI until it has How I Made It and a
 * Process Proof, and then as it claims; for sale only with its work shown and never AI generated, and
 * got only by its creator until payments open; the Human-Crafted Authenticity worked out from the votes,
 * which the page never sees - only the counts and the asker's own; one vote each, never on your own
 * listing and never on work not shown; a listing taken down only by its creator or admin; and nothing
 * published but a model or a picture.
 */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');
const GLB = Buffer.from([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]).toString('base64');

function listing(votes: Record<string, 'like' | 'dislike'> = {}, over: Partial<Listing> = {}): Listing {
  return {
    id: '0123456789abcdef', title: 'Stone Golem', description: '', claim: 'human-made', forSale: false, how: 'Sculpted in Blender over a week.', kind: 'model',
    file: '0123456789abcdef-asset.glb', fileName: 'golem.glb', proofs: ['0123456789abcdef-proof-0.png'], creator: 'ash', creatorName: 'Ash', created: 1, votes,
    ...over,
  };
}
const publish = (fields: Record<string, unknown>): string => JSON.stringify({ title: 'Golem', asset: { name: 'golem.glb', data: GLB }, ...fields });

const account = (id: string, admin = false): Account => ({ id, name: id, ...hashPassword('pw'), admin, created: 0 });

describe('the Human-Crafted Authenticity', () => {
  it('is the share of votes that are likes, to a whole percent, and nothing with no votes', () => {
    expect(authenticity(45, 3)).toBe(94);
    expect(authenticity(1, 0)).toBe(100);
    expect(authenticity(0, 2)).toBe(0);
    expect(authenticity(0, 0)).toBeNull();
  });

  it('is shown with the counts and the asker’s own vote, never who voted what', () => {
    const shown = viewOf(listing({ bramble: 'like', quim: 'like', violet: 'dislike' }), 'violet');
    expect(shown).toMatchObject({ likes: 2, dislikes: 1, authenticity: 67, mine: 'dislike', own: false, proofCount: 1, supported: true, mark: 'human-made' });
    expect(shown).not.toHaveProperty('votes');
    expect(shown).not.toHaveProperty('file');
    expect(shown).not.toHaveProperty('proofs');
    expect(viewOf(listing(), 'ash').own).toBe(true);
    expect(viewOf(listing(), null).mine).toBeNull();
  });
});

describe('showing your work', () => {
  it('is How I Made It and at least one Process Proof; without both a listing is marked AI, whatever it claims', () => {
    expect(supported(listing())).toBe(true);
    expect(supported(listing({}, { how: '  ' }))).toBe(false);
    expect(supported(listing({}, { proofs: [] }))).toBe(false);
    expect(markOf(listing())).toBe('human-made');
    expect(markOf(listing({}, { claim: 'ai-assisted' }))).toBe('ai-assisted');
    expect(markOf(listing({}, { proofs: [] }))).toBe('ai-generated');
    expect(markOf(listing({}, { claim: 'ai-assisted', how: '' }))).toBe('ai-generated');
    expect(viewOf(listing({}, { proofs: [] }), null)).toMatchObject({ claim: 'human-made', mark: 'ai-generated', supported: false });
  });

  it('comes before a sale: for sale needs the work shown, and AI generated is never for sale', () => {
    expect(judgeSale(listing({}, { forSale: false, proofs: [] }))).toBeNull();
    expect(judgeSale(listing({}, { forSale: true }))).toBeNull();
    expect(judgeSale(listing({}, { forSale: true, claim: 'ai-assisted' }))).toBeNull();
    expect(judgeSale(listing({}, { forSale: true, claim: 'ai-assisted', proofs: [] }))).toContain('show your work');
    expect(judgeSale(listing({}, { forSale: true, how: '' }))).toContain('show your work');
    expect(judgeSale(listing({}, { forSale: true, claim: 'ai-generated' }))).toContain('not for sale');
  });

  it('can come later: How I Made It, more pictures, the claim, free or for sale', () => {
    const has = (id: string): number | null => (id === '0123456789abcdef' ? 2 : null);
    const later = judgeUpdate(JSON.stringify({ id: '0123456789abcdef', how: ' Blender. ', claim: 'ai-assisted', forSale: true, addProofs: [{ name: 's.png', data: PNG }] }), has);
    expect(later).toMatchObject({ ok: true, draft: { id: '0123456789abcdef', how: 'Blender.', claim: 'ai-assisted', forSale: true, addProofs: [{ ext: 'png' }] } });
    // Only what is sent changes.
    const just = judgeUpdate(JSON.stringify({ id: '0123456789abcdef', how: 'x' }), has);
    expect(just.ok && just.draft).toEqual({ id: '0123456789abcdef', how: 'x', addProofs: [] });
    // Never past the most pictures a listing shows, counting those it has.
    const pictures = Array.from({ length: MOST_PROOFS - 1 }, () => ({ data: PNG }));
    expect(judgeUpdate(JSON.stringify({ id: '0123456789abcdef', addProofs: pictures }), has)).toMatchObject({ ok: false });
    expect(judgeUpdate(JSON.stringify({ id: '0123456789abcdef', addProofs: pictures.slice(1) }), has).ok).toBe(true);
    expect(judgeUpdate(JSON.stringify({ id: 'fedcba9876543210', how: 'x' }), has)).toMatchObject({ ok: false, reason: 'no such listing' });
    expect(judgeUpdate(JSON.stringify({ id: '0123456789abcdef', claim: 'robot' }), has)).toMatchObject({ ok: false });
    expect(judgeUpdate(JSON.stringify({ id: '0123456789abcdef', addProofs: [{ data: GLB }] }), has)).toMatchObject({ ok: false });
  });
});

describe('getting a listing', () => {
  it('is anybody’s when it is free; when it is for sale, only its creator’s until payments open', () => {
    expect(mayGet(listing(), null)).toBe(true);
    expect(mayGet(listing(), account('bramble'))).toBe(true);
    expect(mayGet(listing({}, { forSale: true }), account('bramble'))).toBe(false);
    expect(mayGet(listing({}, { forSale: true }), null)).toBe(false);
    expect(mayGet(listing({}, { forSale: true }), account('ash'))).toBe(true);
  });
});

describe('a vote', () => {
  it('is one each, changed or taken back, and never on your own listing', () => {
    const shown = listing();
    expect(castVote(shown, 'bramble', 'like')).toBeNull();
    expect(castVote(shown, 'bramble', 'dislike')).toBeNull();
    expect(shown.votes).toEqual({ bramble: 'dislike' });
    expect(castVote(shown, 'bramble', null)).toBeNull();
    expect(shown.votes).toEqual({});
    expect(castVote(shown, 'ash', 'like')).toContain('your own');
    expect(shown.votes).toEqual({});
  });

  it('waits for the work to be shown: there is nothing to judge before', () => {
    const unshown = listing({}, { proofs: [] });
    expect(castVote(unshown, 'bramble', 'like')).toContain('shows their work');
    expect(unshown.votes).toEqual({});
    // A vote from before can still be taken back.
    const was = listing({ bramble: 'dislike' }, { how: '' });
    expect(castVote(was, 'bramble', null)).toBeNull();
    expect(was.votes).toEqual({});
  });

  it('names a listing and like, dislike or nothing', () => {
    expect(judgeVote(JSON.stringify({ id: '0123456789abcdef', vote: 'like' }))).toEqual({ ok: true, id: '0123456789abcdef', vote: 'like' });
    expect(judgeVote(JSON.stringify({ id: '0123456789abcdef', vote: null }))).toMatchObject({ ok: true, vote: null });
    expect(judgeVote(JSON.stringify({ id: '../../x', vote: 'like' }))).toMatchObject({ ok: false });
    expect(judgeVote(JSON.stringify({ id: '0123456789abcdef', vote: 'love' }))).toMatchObject({ ok: false });
    expect(judgeListingId('not json')).toMatchObject({ ok: false });
  });
});

describe('taking a listing down', () => {
  it('is for its creator, or admin', () => {
    expect(mayRemove(listing(), account('ash'))).toBe(true);
    expect(mayRemove(listing(), account('admin', true))).toBe(true);
    expect(mayRemove(listing(), account('bramble'))).toBe(false);
  });
});

describe('a publish', () => {
  it('is a model or a picture, told by its first bytes, never by its name', () => {
    expect(sniff(Buffer.from(GLB, 'base64'))).toMatchObject({ kind: 'model', ext: 'glb' });
    expect(sniff(Buffer.from(PNG, 'base64'))).toMatchObject({ kind: 'image', ext: 'png' });
    expect(sniff(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBeNull();
  });

  it('takes a title, the words, how it was made, free or for sale, the asset, and pictures for its proof', () => {
    const made = judgePublish(JSON.stringify({
      title: ' Stone Golem ', description: 'A golem.', claim: 'ai-assisted', forSale: true, how: 'Blender, a week; the AI drafted the texture.',
      asset: { name: 'golem.glb', data: `data:model/gltf-binary;base64,${GLB}` }, proofs: [{ name: 'shot.png', data: PNG }, { name: 'draft.png', data: PNG }],
    }));
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.draft).toMatchObject({ title: 'Stone Golem', claim: 'ai-assisted', forSale: true, asset: { kind: 'model', ext: 'glb', name: 'golem.glb' } });
    expect(made.draft.proofs.map((proof) => proof.ext)).toEqual(['png', 'png']);
  });

  it('needs no evidence to be free - it is marked AI until the work is shown - and says AI generated when it says nothing', () => {
    expect(judgePublish(publish({}))).toMatchObject({ ok: true, draft: { claim: 'ai-generated', forSale: false, how: '', proofs: [] } });
    expect(judgePublish(publish({ claim: 'human-made' }))).toMatchObject({ ok: true, draft: { claim: 'human-made' } });
  });

  it('is refused for sale without its work shown, or AI generated', () => {
    expect(judgePublish(publish({ claim: 'human-made', forSale: true }))).toMatchObject({ ok: false });
    expect(judgePublish(publish({ claim: 'ai-assisted', forSale: true, how: 'Blender.' }))).toMatchObject({ ok: false });
    expect(judgePublish(publish({ claim: 'ai-generated', forSale: true, how: 'A prompt.', proofs: [{ data: PNG }] }))).toMatchObject({ ok: false, reason: 'AI generated work is not for sale' });
  });

  it('takes pictures for its proof, and at most so many', () => {
    expect(judgePublish(publish({ proofs: [{ data: GLB }] }))).toMatchObject({ ok: false });
    expect(judgePublish(publish({ proofs: { data: PNG } }))).toMatchObject({ ok: false });
    expect(judgePublish(publish({ proofs: Array.from({ length: MOST_PROOFS + 1 }, () => ({ data: PNG })) }))).toMatchObject({ ok: false });
    expect(judgePublish(publish({ claim: 'robot' }))).toMatchObject({ ok: false });
  });

  it('is refused without a title, with an asset that is not art, or with too many words', () => {
    expect(judgePublish(JSON.stringify({ title: '', asset: { name: 'a.png', data: PNG } }))).toMatchObject({ ok: false });
    expect(judgePublish(JSON.stringify({ title: 'Virus', asset: { name: 'a.exe', data: Buffer.from('MZ\u0090\u0000').toString('base64') } }))).toMatchObject({ ok: false });
    expect(judgePublish(JSON.stringify({ title: 'Long', how: 'x'.repeat(2001), asset: { name: 'a.png', data: PNG } }))).toMatchObject({ ok: false });
    expect(judgePublish('not json')).toMatchObject({ ok: false });
  });
});

describe('the listings kept from before claims', () => {
  it('come back with one proof as a list, marked AI, and free', () => {
    const root = mkdtempSync(join(tmpdir(), 'store-'));
    try {
      const file = join(root, LISTINGS_FILE);
      mkdirSync(dirname(file), { recursive: true });
      const { claim: _claim, forSale: _forSale, proofs: _proofs, ...old } = listing();
      writeFileSync(file, JSON.stringify([{ ...old, proof: 'x-proof.png' }, { ...old, id: 'fedcba9876543210', proof: null }]));
      const [first, second] = readListings(root);
      expect(first).toMatchObject({ claim: 'ai-generated', forSale: false, proofs: ['x-proof.png'] });
      expect(first).not.toHaveProperty('proof');
      expect(second!.proofs).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the engine\u2019s models in the store', () => {
  const files = [{ file: 'bandit-cutter.glb', created: 5 }, { file: 'Arty.glb', created: 6 }];

  it('are a free listing each, by The engine, claimed as its art mark says and marked AI until its work is shown', () => {
    const { listings, changed } = engineListings([listing()], files, { 'model:arty': 'ai-assisted' });
    expect(changed).toBe(true);
    const [, cutter, arty] = listings;
    expect(cutter).toMatchObject({ id: engineListingId('bandit-cutter.glb'), title: 'Bandit Cutter', claim: 'ai-generated', forSale: false, kind: 'model', file: 'bandit-cutter.glb', creator: 'admin', creatorName: 'The engine', engine: true });
    expect(arty).toMatchObject({ title: 'Arty', claim: 'ai-assisted' });
    expect(viewOf(arty!, null)).toMatchObject({ mark: 'ai-generated', supported: false, engine: true });
  });

  it('keep their votes and their work, and go with their file', () => {
    const first = engineListings([], files, {}).listings;
    first[0]!.votes = { bramble: 'like' };
    expect(engineListings(first, files, {})).toEqual({ listings: first, changed: false });
    const gone = engineListings(first, files.slice(0, 1), {});
    expect(gone.changed).toBe(true);
    expect(gone.listings.map((entry) => entry.file)).toEqual(['bandit-cutter.glb']);
    expect(gone.listings[0]!.votes).toEqual({ bramble: 'like' });
  });

  it('are never taken down, not even by admin', () => {
    const [engine] = engineListings([], files, {}).listings;
    expect(mayRemove(engine!, account('admin', true))).toBe(false);
  });

  it('say whether the asker has them in their own models', () => {
    const [engine] = engineListings([], files, {}).listings;
    expect(viewOf(engine!, 'bramble', new Set([engine!.id])).inYours).toBe(true);
    expect(viewOf(engine!, 'bramble').inYours).toBe(false);
  });

  it('are titled from their file', () => {
    expect(titleOf('stone_golem.glb')).toBe('Stone Golem');
  });
});

