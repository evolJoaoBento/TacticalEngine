/**
 * The rule each kind of art starts from, and a mark changed from it (`art-provenance.ts`): only the
 * card art from the printed material is made by hand; a change is kept, said once, and every badge on
 * screen follows; only AI art puts up the note.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { defaultProvenance, hoverArt, hoveredArt, isAi, provenanceOf, setProvenance, subscribe } from './art-provenance';
import { resetCardArt, useCardArtIndex } from './ui/card-art';

const kept = async () => ({ ok: true, text: async () => '{}' });

afterEach(() => resetCardArt());

describe('how art was made, before anybody says', () => {
  it('is AI generated for every model and equipment picture, file or code', () => {
    expect(defaultProvenance('model:quim')).toBe('ai-generated');
    expect(defaultProvenance('model:tree-prop')).toBe('ai-generated');
    expect(defaultProvenance('equipment:broadsword.webp')).toBe('ai-generated');
  });

  it('is made by hand only for a card illustration from the printed material', () => {
    useCardArtIndex({ 'bare-bones': 'bare-bones.jpg' });
    expect(defaultProvenance('card:bare-bones')).toBe('human-made');
    // A card with no illustration draws its own emblem: that is the engine's, not the book's.
    expect(defaultProvenance('card:get-back-up')).toBe('ai-generated');
  });
});

describe('a mark changed from its rule', () => {
  it('is sent once, kept, and every badge is told; marking it as its rule takes the mark away', async () => {
    const bodies: unknown[] = [];
    let told = 0;
    const stop = subscribe(() => {
      told += 1;
    });
    const send = async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return kept();
    };
    expect(await setProvenance('model:violet', 'ai-assisted', send)).toBeNull();
    expect(provenanceOf('model:violet')).toBe('ai-assisted');
    expect(isAi('model:violet')).toBe(true);
    expect(await setProvenance('model:violet', 'human-made', send)).toBeNull();
    expect(isAi('model:violet')).toBe(false);
    expect(await setProvenance('model:violet', 'ai-generated', send)).toBeNull();
    expect(bodies).toEqual([
      { key: 'model:violet', provenance: 'ai-assisted' },
      { key: 'model:violet', provenance: 'human-made' },
      { key: 'model:violet', provenance: null },
    ]);
    expect(told).toBe(3);
    stop();
  });

  it('is not changed when the server does not keep it, and says why', async () => {
    const refused = await setProvenance('model:scarlet', 'human-made', async () => ({ ok: false, text: async () => 'this server does not keep how art was made' }));
    expect(refused).toContain('does not keep');
    expect(provenanceOf('model:scarlet')).toBe('ai-generated');
  });
});

describe('the note in the corner', () => {
  it('is up while AI art is under the pointer, and not for art made by hand', () => {
    hoverArt('model:quim');
    expect(hoveredArt()).toEqual({ key: 'model:quim', provenance: 'ai-generated' });
    hoverArt(null);
    expect(hoveredArt()).toBeNull();
    useCardArtIndex({ 'bare-bones': 'bare-bones.jpg' });
    hoverArt('card:bare-bones');
    expect(hoveredArt()).toBeNull();
  });
});
