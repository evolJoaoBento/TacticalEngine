import { describe, expect, it } from 'vitest';
import { memoryStore } from '../../src/game/save-slots';
import {
  CARD_ART_DIRECTORY,
  CardArtImports,
  loadCardArtIndex,
  parseCardArtIndex,
  resolveArt,
} from '../../src/game/ui/card-art';

/**
 * Which picture a card shows.
 *
 * Three tiers — imported, then a file in the directory, then the emblem the
 * card draws for itself — and the rule that keeps the console quiet: a URL is
 * only ever built from the index, never guessed.
 */

const response = (ok: boolean, body: string) => async () => ({ ok, text: async () => body });

describe('reading the card art index', () => {
  it('treats a missing, empty or unreadable index as no art at all', () => {
    // A broken index costs a player their illustrations, never their game.
    expect(parseCardArtIndex(null)).toEqual({});
    expect(parseCardArtIndex('')).toEqual({});
    expect(parseCardArtIndex('   ')).toEqual({});
    expect(parseCardArtIndex('not json')).toEqual({});
    expect(parseCardArtIndex('[1, 2, 3]')).toEqual({});
    expect(parseCardArtIndex('null')).toEqual({});
    expect(parseCardArtIndex('{}')).toEqual({});
  });

  it('keeps file names and drops anything that is a path', () => {
    const index = parseCardArtIndex(JSON.stringify({
      'bare-bones': 'bare-bones.jpg',
      'get-back-up': 'nested/get-back-up.jpg',
      escaping: '../../secrets.png',
      empty: '',
      wrong: 42,
    }));
    expect(index).toEqual({ 'bare-bones': 'bare-bones.jpg' });
  });

  it('reads the index over fetch, and shrugs off every way that can fail', async () => {
    await expect(loadCardArtIndex(response(true, '{"bare-bones":"bare-bones.jpg"}')))
      .resolves.toEqual({ 'bare-bones': 'bare-bones.jpg' });
    // 404 is the normal case: most machines have no directory.
    await expect(loadCardArtIndex(response(false, 'Not found'))).resolves.toEqual({});
    await expect(loadCardArtIndex(async () => { throw new Error('offline'); })).resolves.toEqual({});
  });
});

describe('art a player imported', () => {
  it('keeps, returns and forgets a picture for one card', () => {
    const imports = new CardArtImports(memoryStore());
    expect(imports.get('bare-bones')).toBeNull();
    expect(imports.set('bare-bones', 'data:image/jpeg;base64,AAA')).toBeNull();
    expect(imports.get('bare-bones')).toBe('data:image/jpeg;base64,AAA');
    imports.remove('bare-bones');
    expect(imports.get('bare-bones')).toBeNull();
  });

  it('says so when the browser has no room, rather than failing silently', () => {
    // `localStorage` throws when it is full, and a player who just chose a file
    // deserves a sentence rather than nothing happening.
    const full = { get: () => null, set: () => { throw new Error('QuotaExceededError'); }, remove: () => {} };
    const issue = new CardArtImports(full).set('bare-bones', 'data:image/jpeg;base64,AAA');
    expect(issue).toMatch(/no room/i);
  });

  it('still shows art imported before the rename, and forgets it from both keys', () => {
    // Imported art was kept under `polyheart:card-art:` before the project was renamed. It is read
    // as a fallback and never written, so a player's own pictures survive without a migration step.
    const map = new Map<string, string>([['polyheart:card-art:bare-bones', 'data:image/jpeg;base64,OLD']]);
    const imports = new CardArtImports(memoryStore(map));
    expect(imports.get('bare-bones')).toBe('data:image/jpeg;base64,OLD');

    // Remove must clear the old key too, or "Remove" appears to do nothing.
    imports.remove('bare-bones');
    expect(imports.get('bare-bones')).toBeNull();
    expect(map.has('polyheart:card-art:bare-bones')).toBe(false);
  });

  it('prefers the current key when a card has art under both', () => {
    const map = new Map<string, string>([
      ['tactical:card-art:bare-bones', 'data:image/jpeg;base64,NEW'],
      ['polyheart:card-art:bare-bones', 'data:image/jpeg;base64,OLD'],
    ]);
    expect(new CardArtImports(memoryStore(map)).get('bare-bones')).toBe('data:image/jpeg;base64,NEW');
  });

  it('survives a store that refuses to be read or written at all', () => {
    // Some browsers throw on the very first touch of storage; that has to read
    // as "no imported art", not take the page down.
    const dead = {
      get: () => { throw new Error('denied'); },
      set: () => { throw new Error('denied'); },
      remove: () => { throw new Error('denied'); },
    };
    const imports = new CardArtImports(dead);
    expect(imports.get('bare-bones')).toBeNull();
    expect(imports.set('bare-bones', 'data:x')).not.toBeNull();
    expect(() => imports.remove('bare-bones')).not.toThrow();
  });
});

describe('choosing what a card shows', () => {
  const index = { 'bare-bones': 'bare-bones.jpg' };

  it('draws the emblem when there is no file and nothing imported', () => {
    expect(resolveArt('bare-bones', {}, null)).toEqual({ kind: 'sigil' });
    expect(resolveArt('unknown-card', index, null)).toEqual({ kind: 'sigil' });
  });

  it('uses a file from the directory when the index names one', () => {
    expect(resolveArt('bare-bones', index, null)).toEqual({
      kind: 'image',
      src: `${CARD_ART_DIRECTORY}bare-bones.jpg`,
    });
  });

  it('lets imported art win over the directory', () => {
    // The player picked a file precisely to replace what was on screen.
    expect(resolveArt('bare-bones', index, 'data:image/jpeg;base64,MINE')).toEqual({
      kind: 'image',
      src: 'data:image/jpeg;base64,MINE',
    });
  });

  it('ignores an empty import rather than showing a blank frame', () => {
    expect(resolveArt('bare-bones', {}, '')).toEqual({ kind: 'sigil' });
  });

  it('only ever builds a URL inside the art directory', () => {
    for (const [id, imported] of [['bare-bones', null], ['unknown-card', null]] as const) {
      const art = resolveArt(id, index, imported);
      if (art.kind === 'image') expect(art.src.startsWith(CARD_ART_DIRECTORY)).toBe(true);
    }
  });
});
