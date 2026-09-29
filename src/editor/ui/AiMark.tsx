/**
 * The mark on how art was made, wherever the editor shows a picture of it: a little tag in its corner -
 * red **AI** for AI generated, yellow **AI** for AI assisted, green **Human** for human made - a note in
 * the bottom-right corner saying which while the pointer is over it (the game's own note, `AiNote.tsx`), and a menu - from a
 * click on the badge, or a right-click on any picture - to say otherwise: AI Generated, AI Assisted or
 * Human made. A change is kept for that piece of art in every project (`art-provenance.ts`), so it is
 * said once.
 *
 * The badge (`AiBadge`) and the pointer handlers (`artMarkHandlers`) go on each picture; the note and
 * the menu are drawn once, by `ArtMarkLayer`, which the editor's shell holds.
 */

import { useEffect, useState } from 'preact/hooks';
import {
  PROVENANCE_LABEL,
  hoverArt,
  markMenu,
  openMarkMenu,
  provenanceOf,
  setProvenance,
  subscribe,
  subscribeNote,
  type ArtKey,
  type Provenance,
} from '../../game/art-provenance';
import { ArtNote } from '../../game/ui/AiNote';

/** Redraw when any mark changes. */
function useMarks(): void {
  const [, redraw] = useState(0);
  useEffect(() => subscribe(() => redraw((n) => n + 1)), []);
}

/** What goes on a picture so hovering it puts up the note and right-clicking it opens the menu. */
export function artMarkHandlers(key: ArtKey | null): {
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onContextMenu?: (e: MouseEvent) => void;
} {
  if (key === null) return {};
  return {
    onMouseEnter: () => hoverArt(key),
    onMouseLeave: () => hoverArt(null),
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      openMarkMenu({ key, x: e.clientX, y: e.clientY });
    },
  };
}

/** What each tag says: the same word for either kind of AI, told apart by colour. */
const TAG: Readonly<Record<Provenance, string>> = { 'ai-generated': 'AI', 'ai-assisted': 'AI', 'human-made': 'Human' };

/**
 * The tag in the picture's corner, or inline beside a name (`inline`): red for AI generated, yellow for
 * AI assisted, green for human made. Nothing only where there is no art (`null`).
 */
export function AiBadge(props: { art: ArtKey | null; inline?: boolean }): preact.JSX.Element | null {
  useMarks();
  if (props.art === null) return null;
  const art = props.art;
  const provenance = provenanceOf(art);
  return (
    <span
      role="button"
      tabIndex={0}
      class={`ph-ai-badge is-${provenance}${props.inline === true ? ' is-inline' : ''}`}
      data-testid="ai-badge"
      data-art={art}
      data-provenance={provenance}
      title={`${PROVENANCE_LABEL[provenance]} - click to change`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        openMarkMenu({ key: art, x: e.clientX, y: e.clientY });
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.stopPropagation();
        e.preventDefault();
        const box = e.currentTarget.getBoundingClientRect();
        openMarkMenu({ key: art, x: box.left, y: box.bottom });
      }}
    >
      {TAG[provenance]}
    </span>
  );
}

/** The note in the bottom-right corner and the menu that changes a mark: drawn once, over the editor. */
export function ArtMarkLayer(): preact.JSX.Element {
  const [, redraw] = useState(0);
  useEffect(() => subscribeNote(() => redraw((n) => n + 1)), []);
  useMarks();
  const [said, setSaid] = useState<string | null>(null);
  const open = markMenu();

  useEffect(() => {
    if (open === null) return;
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') openMarkMenu(null);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open !== null]);

  const choose = async (key: ArtKey, provenance: Provenance): Promise<void> => {
    setSaid('Keeping it…');
    const refused = await setProvenance(key, provenance);
    if (refused === null) {
      setSaid(null);
      openMarkMenu(null);
    } else setSaid(`Not kept: ${refused}.`);
  };

  return (
    <>
      {/* The same note the game puts up: faded red, a serif hand, the bottom-right corner. */}
      <ArtNote />
      {open === null ? null : (
        <div class="ph-ai-menu-backdrop" onPointerDown={() => { setSaid(null); openMarkMenu(null); }}>
          <div
            class="ph-ai-menu"
            data-testid="ai-menu"
            data-art={open.key}
            style={{ left: `${Math.min(open.x, window.innerWidth - 200)}px`, top: `${Math.min(open.y, window.innerHeight - 150)}px` }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div class="ph-ai-menu-head">How it was made · every project</div>
            {(['ai-generated', 'ai-assisted', 'human-made'] as const).map((provenance) => (
              <button
                key={provenance}
                type="button"
                class={`ph-ai-menu-item${provenanceOf(open.key) === provenance ? ' is-on' : ''}`}
                data-testid={`ai-mark-${provenance}`}
                onClick={() => void choose(open.key, provenance)}
              >
                {PROVENANCE_LABEL[provenance]}
              </button>
            ))}
            {said === null ? null : <div class="ph-ai-menu-said" data-testid="ai-menu-said">{said}</div>}
          </div>
        </div>
      )}
    </>
  );
}
