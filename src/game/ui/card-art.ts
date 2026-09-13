/**
 * Where a domain card's picture comes from.
 *
 * Three tiers, and the first one that answers wins:
 *
 * 1. **Art you imported** for that card, kept in this browser.
 * 2. **A file in `public/cards/`**, named in `public/cards/index.json`.
 * 3. **The emblem the card draws for itself** (`card-sigil.ts`).
 *
 * Imported art wins because you pick a file precisely to replace what is on
 * screen. The generated emblem is last because it always works: it needs no
 * files, so a fresh clone renders a complete card.
 *
 * **A URL is only ever built from the index.** The app never guesses at
 * `/cards/<id>.jpg` and hopes: a guess that missed would log a 404 for every
 * card without a file, and `public/cards/` is git-ignored, so on most machines
 * that is every card. The index is read once at boot with `fetch`, whose miss
 * is silent, and a card with no entry falls through to its emblem.
 *
 * `tools/index-card-art.mjs` writes the index by listing the directory. There
 * is no downloader any more: what is in the directory is what you put there.
 */

import type { SlotStore } from '../save-slots';

/** Card id to file name, as `public/cards/index.json` holds it. */
export type CardArtIndex = Readonly<Record<string, string>>;

/** Where the files are served from. */
export const CARD_ART_DIRECTORY = '/cards/';

/** The index's own path, for the one fetch at boot. */
export const CARD_ART_INDEX_URL = `${CARD_ART_DIRECTORY}index.json`;

const IMPORT_PREFIX = 'tactical:card-art:';

/**
 * The prefix this app wrote before it was renamed. Read, never written — a picture somebody
 * imported keeps showing, and choosing a new one moves it forward. `remove` clears both, or
 * "Remove" would appear to do nothing for art stored under the old name.
 */
const LEGACY_IMPORT_PREFIX = 'polyheart:card-art:';

export type CardArt =
  | { readonly kind: 'image'; readonly src: string }
  | { readonly kind: 'sigil' };

/**
 * Read an index that may not be there, may be empty, or may be junk.
 *
 * Anything unreadable means "no art", never an exception: a broken index must
 * cost a player their illustrations, not their game.
 */
export function parseCardArtIndex(text: string | null): CardArtIndex {
  if (text === null || text.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const index: Record<string, string> = {};
    for (const [id, file] of Object.entries(parsed as Record<string, unknown>)) {
      // A file name, not a path: nothing here may escape the directory.
      if (typeof file === 'string' && file !== '' && !file.includes('/') && !file.includes('..')) {
        index[id] = file;
      }
    }
    return index;
  } catch {
    return {};
  }
}

/** Fetch the index. A missing file is not an error; it means no art. */
export async function loadCardArtIndex(
  fetcher: (url: string) => Promise<{ ok: boolean; text: () => Promise<string> }> = fetch,
  url: string = CARD_ART_INDEX_URL,
): Promise<CardArtIndex> {
  try {
    const response = await fetcher(url);
    if (!response.ok) return {};
    return parseCardArtIndex(await response.text());
  } catch {
    return {};
  }
}

/** Art a player imported, kept per browser under its own key prefix. */
export class CardArtImports {
  private readonly store: SlotStore;

  constructor(store: SlotStore) {
    this.store = store;
  }

  get(cardId: string): string | null {
    try {
      return this.store.get(IMPORT_PREFIX + cardId) ?? this.store.get(LEGACY_IMPORT_PREFIX + cardId);
    } catch {
      return null;
    }
  }

  /**
   * Keep a picture for a card. Returns why it could not be kept, or `null` when
   * it was: `localStorage` is a few megabytes and throws when it is full, and a
   * player who has just chosen a file deserves to be told rather than watch
   * nothing happen.
   */
  set(cardId: string, dataUrl: string): string | null {
    try {
      this.store.set(IMPORT_PREFIX + cardId, dataUrl);
      return null;
    } catch {
      return 'There was no room to keep that picture. Remove some imported art and try again.';
    }
  }

  remove(cardId: string): void {
    try {
      this.store.remove(IMPORT_PREFIX + cardId);
      this.store.remove(LEGACY_IMPORT_PREFIX + cardId);
    } catch {
      // A store that refuses to forget is not worth taking the page down for.
    }
  }
}

/**
 * The picture for one card: imported, then the directory, then its emblem.
 */
export function resolveArt(cardId: string, index: CardArtIndex, imported: string | null): CardArt {
  if (imported !== null && imported !== '') return { kind: 'image', src: imported };
  const file = index[cardId];
  if (file !== undefined) return { kind: 'image', src: CARD_ART_DIRECTORY + file };
  return { kind: 'sigil' };
}

// ---------------------------------------------------------------------------
// The one index and one import store the running app shares
// ---------------------------------------------------------------------------

let currentIndex: CardArtIndex = {};
let currentImports: CardArtImports | null = null;

/** Hand the app the index read at boot. */
export function useCardArtIndex(index: CardArtIndex): void {
  currentIndex = index;
}

/** Hand the app somewhere to keep imported art. */
export function useCardArtImports(imports: CardArtImports): void {
  currentImports = imports;
}

export function cardArtIndex(): CardArtIndex {
  return currentIndex;
}

export function cardArtImports(): CardArtImports | null {
  return currentImports;
}

/** What to draw for this card, right now. */
export function artFor(cardId: string): CardArt {
  return resolveArt(cardId, currentIndex, currentImports?.get(cardId) ?? null);
}

/** Forget everything the app was told; tests start from nothing. */
export function resetCardArt(): void {
  currentIndex = {};
  currentImports = null;
}
