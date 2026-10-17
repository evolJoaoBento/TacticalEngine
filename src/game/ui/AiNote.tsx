/**
 * The note that says art under the pointer was made with AI: faded red, in a serif hand, in the
 * bottom-right corner of the page, for as long as the pointer is over it - a picture on a card, a
 * portrait, a mini on the New Game table, or a creature, a prop or a tile on the board.
 *
 * One note for the whole page (`ArtNote`), drawn by whatever screen is up - the play screen, the menu,
 * New Game's table, the editor - and put up or taken down from anywhere (`hoverArt` in
 * `art-provenance.ts`). A picture takes `artNoteHandlers` to put it up while it is hovered. What it says
 * is the art's mark: AI Generated, in red, or AI Assisted, in yellow; art made by hand puts up nothing.
 */

import { useEffect, useState } from 'preact/hooks';
import { PROVENANCE_LABEL, hoverArt, hoveredArt, subscribe, subscribeNote, type ArtKey } from '../art-provenance';
import './ai-note.css';

/** What goes on a picture so hovering it puts up the note. */
export function artNoteHandlers(key: ArtKey | null): { onMouseEnter?: () => void; onMouseLeave?: () => void } {
  if (key === null) return {};
  return { onMouseEnter: () => hoverArt(key), onMouseLeave: () => hoverArt(null) };
}

/** The note itself, in the corner, while AI art is under the pointer. */
export function ArtNote(): preact.JSX.Element | null {
  const [, redraw] = useState(0);
  useEffect(() => subscribeNote(() => redraw((n) => n + 1)), []);
  useEffect(() => subscribe(() => redraw((n) => n + 1)), []);
  // Whatever screen held the note is gone with it: nothing is left saying so over the next one.
  useEffect(() => () => hoverArt(null), []);
  const hovered = hoveredArt();
  if (hovered === null) return null;
  return (
    <div class={`ai-note is-${hovered.provenance}`} data-testid="ai-note" data-provenance={hovered.provenance} role="status">
      {PROVENANCE_LABEL[hovered.provenance]}
    </div>
  );
}
