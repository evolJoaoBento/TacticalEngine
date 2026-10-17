/**
 * How each piece of art the editor shows was made: AI generated, AI assisted, or made by hand.
 *
 * Each kind of art has a rule (`defaultProvenance`), which is how the user asked for them to start:
 * the only art made by hand is what was pulled from the game's own printed material - the card
 * illustrations in `public/cards/` (`card-art.ts`'s index) - and everything else is AI generated: every
 * model, whether from a file or drawn by the engine's code, every equipment picture, a card's drawn
 * emblem, and card art imported into a browser. What has been changed from the rule is kept for every project
 * in `projects/art-provenance.json` (`tools/art-provenance.ts`), which the page is served as
 * `PROVENANCE` and changes through `setProvenance`. The page keeps its own copy, moved with each change
 * it makes, and tells whatever draws a badge (`subscribe`) so every badge on screen follows at once.
 *
 * The editor's red AI badge and the note in the bottom-right corner (`ui/AiMark.tsx`) read this.
 */

import { PROVENANCE_URL } from 'virtual:art-provenance';
import { PROVENANCE } from './engine-lists';
import { SAVE_HEADER } from 'virtual:boot-project';
import { artFor, CARD_ART_DIRECTORY } from './ui/card-art';

export type Provenance = 'ai-generated' | 'ai-assisted' | 'human-made';

/** A piece of art: a model by id, a card's picture by card id, or an equipment picture by its file. */
export type ArtKey = `model:${string}` | `card:${string}` | `equipment:${string}`;

/** How each is said, on the badge's note and in the menu that changes it. */
export const PROVENANCE_LABEL: Readonly<Record<Provenance, string>> = {
  'ai-generated': 'AI Generated',
  'ai-assisted': 'AI Assisted',
  'human-made': 'Human made',
};

/**
 * How a piece of art was made when nothing has been said about it: made by hand only when it is a
 * card's illustration from the printed material, which `public/cards/` holds; AI generated otherwise.
 */
export function defaultProvenance(key: ArtKey): Provenance {
  const [kind, ...rest] = key.split(':');
  if (kind !== 'card') return 'ai-generated';
  const art = artFor(rest.join(':'));
  return art.kind === 'image' && art.src.startsWith(CARD_ART_DIRECTORY) ? 'human-made' : 'ai-generated';
}

const kept = new Map<string, Provenance>(Object.entries(PROVENANCE));
const listeners = new Set<() => void>();

/** How a piece of art was made: as it was marked, or else its kind's rule. */
export function provenanceOf(key: ArtKey): Provenance {
  return kept.get(key) ?? defaultProvenance(key);
}

/** Whether a piece of art is marked as made with AI, generated or assisted. */
export function isAi(key: ArtKey): boolean {
  return provenanceOf(key) !== 'human-made';
}

/** Be told when a mark changes. Returns the way to stop. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Mark a piece of art, for every project: sent to the dev server to keep. Marking it as its rule
 * says takes the mark out of the file, so the file holds only what differs. Resolves to nothing when
 * it was kept, or to why it was not.
 */
export async function setProvenance(
  key: ArtKey,
  provenance: Provenance,
  send: (url: string, init: RequestInit) => Promise<{ ok: boolean; text: () => Promise<string> }> = fetch,
): Promise<string | null> {
  const stored = provenance === defaultProvenance(key) ? null : provenance;
  try {
    const response = await send(PROVENANCE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [SAVE_HEADER]: '1' },
      body: JSON.stringify({ key, provenance: stored }),
    });
    if (!response.ok) return (await response.text()) || 'the server would not keep it';
  } catch {
    return 'the server could not be reached';
  }
  if (stored === null) kept.delete(key);
  else kept.set(key, stored);
  for (const listener of listeners) listener();
  return null;
}

// ---- The note in the bottom-right corner while something AI-made is under the pointer.

let hovered: { key: ArtKey; provenance: Provenance } | null = null;
const noteListeners = new Set<() => void>();

/** What the note says now, or nothing. */
export function hoveredArt(): { key: ArtKey; provenance: Provenance } | null {
  return hovered;
}

/** The pointer is over this piece of art, or over none (`null`). Only AI art puts up a note. */
export function hoverArt(key: ArtKey | null): void {
  const next = key === null || !isAi(key) ? null : { key, provenance: provenanceOf(key) };
  if (next?.key === hovered?.key && next?.provenance === hovered?.provenance) return;
  hovered = next;
  for (const listener of noteListeners) listener();
}

/** Be told when the note changes. */
export function subscribeNote(listener: () => void): () => void {
  noteListeners.add(listener);
  return () => noteListeners.delete(listener);
}

// ---- The menu that changes a mark: opened on a piece of art, at the pointer.

let menu: { key: ArtKey; x: number; y: number } | null = null;

/** Where the menu is open, and on what, or nothing. */
export function markMenu(): { key: ArtKey; x: number; y: number } | null {
  return menu;
}

/** Open the menu on a piece of art at a point on the page, or close it (`null`). */
export function openMarkMenu(at: { key: ArtKey; x: number; y: number } | null): void {
  menu = at;
  // The note is for what is under the pointer; the menu is over it now.
  if (at !== null) hovered = null;
  for (const listener of noteListeners) listener();
}
