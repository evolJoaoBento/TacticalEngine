/**
 * The note that says why a room is plain for now: a linked material (`TileSurface.polyHaven`) being fetched from Poly
 * Haven, packed and compressed the first time this browser draws it, and how far it has got - "Castle Brick 07:
 * downloading 3 of 5 maps". Its tiles are drawn in their kind's colour until it is in, which without a word looks like
 * a fault. Gone the moment every material asked for is in, or has failed (a failure is the Tiles workspace's to tell).
 *
 * One note for the whole page, mounted once (`mountSurfaceNote`) and listening to the `SurfaceLibrary` itself, so it
 * is up in play and in the editor alike, over whatever screen is up and in the way of nothing.
 */

import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './surface-note.css';

/** What the note reads of the library: the linked materials on their way, and word when that changes. */
export interface FetchingSurfaces {
  fetching(): readonly { id: string; name: string; said: string }[];
  onChange(listener: (id: string) => void): () => void;
}

/** The note, at the top of the page, while any linked material is on its way. */
export function SurfaceNote(props: { surfaces: FetchingSurfaces }): preact.JSX.Element | null {
  const [, redraw] = useState(0);
  useEffect(() => props.surfaces.onChange(() => redraw((n) => n + 1)), [props.surfaces]);
  const fetching = props.surfaces.fetching();
  if (fetching.length === 0) return null;
  return (
    <div class="surface-note" data-testid="surface-fetching" role="status">
      <div class="surface-note-head">Preparing textures from Poly Haven, once for this browser</div>
      {fetching.map((one) => (
        <div key={one.id} data-surface={one.id}>
          {one.name}: {one.said}…
        </div>
      ))}
    </div>
  );
}

/** The note put on the page, once, for as long as the page is up. */
export function mountSurfaceNote(surfaces: FetchingSurfaces): void {
  const root = document.createElement('div');
  document.body.append(root);
  render(h(SurfaceNote, { surfaces }), root);
}
