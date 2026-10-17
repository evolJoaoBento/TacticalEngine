/**
 * The store as the page talks to it (`store.ts`): the storefront's line, word for word, and what a
 * vote, a publish and showing the work later send.
 */

import { describe, expect, it } from 'vitest';
import { assetUrl, authenticityLine, getListing, proofUrl, publishListing, updateListing, voteOn } from './store';

describe('the line the storefront reads', () => {
  it('is the ratio with its likes and dislikes', () => {
    expect(authenticityLine({ likes: 45, dislikes: 3, authenticity: 94 })).toBe('Human-Crafted Authenticity: 94% (45 Likes / 3 Dislikes)');
    expect(authenticityLine({ likes: 1, dislikes: 1, authenticity: 50 })).toBe('Human-Crafted Authenticity: 50% (1 Like / 1 Dislike)');
  });

  it('says so when nobody has voted, rather than a ratio of nothing', () => {
    expect(authenticityLine({ likes: 0, dislikes: 0, authenticity: null })).toBe('Human-Crafted Authenticity: no votes yet');
  });
});

describe('what the page sends', () => {
  const answer = (body: unknown) => async (_url: string, init?: RequestInit) => {
    sent.push({ url: _url, body: JSON.parse(String(init?.body)) as unknown, header: (init?.headers as Record<string, string>)['x-tactical-save'] });
    return { ok: true, status: 200, json: async () => body };
  };
  const sent: { url: string; body: unknown; header: string | undefined }[] = [];

  it('is a vote as the page itself, and the listing as it now stands comes back', async () => {
    const back = await voteOn('0123456789abcdef', 'like', answer({ id: '0123456789abcdef', likes: 1 }));
    expect(back).toMatchObject({ likes: 1 });
    expect(sent.at(-1)).toEqual({ url: '/__store/vote', body: { id: '0123456789abcdef', vote: 'like' }, header: '1' });
  });

  it('is a publish with how it was made, free or for sale, How I Made It and the Process Proof', async () => {
    await publishListing(
      { title: 'Golem', description: '', claim: 'ai-assisted', forSale: true, how: 'Blender.', asset: { name: 'g.glb', data: 'data:,x' }, proofs: [{ name: 'p.png', data: 'data:,y' }] },
      answer({ id: 'x' }),
    );
    expect(sent.at(-1)!.url).toBe('/__store/publish');
    expect(sent.at(-1)!.body).toMatchObject({ title: 'Golem', claim: 'ai-assisted', forSale: true, how: 'Blender.', proofs: [{ name: 'p.png' }] });
  });

  it('is a Get, and the listing comes back, now in your models', async () => {
    const back = await getListing('0123456789abcdef', answer({ listing: { id: '0123456789abcdef', inYours: true }, model: { id: 'golem' } }));
    expect(back).toEqual({ id: '0123456789abcdef', inYours: true });
    expect(sent.at(-1)).toEqual({ url: '/__store/get', body: { id: '0123456789abcdef' }, header: '1' });
  });

  it('is the work shown later, only what changed', async () => {
    await updateListing('0123456789abcdef', { how: 'Blender.', addProofs: [{ name: 'p.png', data: 'data:,y' }] }, answer({ id: '0123456789abcdef' }));
    expect(sent.at(-1)).toEqual({ url: '/__store/update', body: { id: '0123456789abcdef', how: 'Blender.', addProofs: [{ name: 'p.png', data: 'data:,y' }] }, header: '1' });
  });

  it('finds a listing’s files where the store serves them', () => {
    expect(assetUrl('0123456789abcdef')).toBe('/__store/file/0123456789abcdef/asset');
    expect(assetUrl('0123456789abcdef', true)).toBe('/__store/file/0123456789abcdef/asset?download');
    expect(proofUrl('0123456789abcdef', 2)).toBe('/__store/file/0123456789abcdef/proof/2');
  });
});
