/**
 * Who is at the door of a peer game's host (`docs/PEER.md`): somebody who opened the room's link and is not at the game
 * already, waiting for the host to **Let in** or **Turn away** (`peer-play.ts`, `knocking`). Shown over the lobby and
 * over the game alike - a knock comes whenever it comes - and gone once nobody is waiting. A player already at the
 * game, coming back, is let in without asking, and never shown here.
 */

import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { knocking, letIn, onKnocks, turnAway } from '../peer/peer-play';

function PeerKnocks(): preact.JSX.Element | null {
  const [knocks, setKnocks] = useState(knocking());
  useEffect(() => onKnocks(setKnocks), []);
  if (knocks.length === 0) return null;
  return (
    <div className="play-box peer-lost" role="dialog" aria-label="At the door" data-testid="peer-knocks">
      <div className="play-eyebrow">At the door</div>
      {knocks.map((k) => (
        <div key={k.knock} className="panel-row players-seat" data-testid="peer-knock" data-knock={k.knock}>
          <span style={{ flex: 1 }}>{k.who.name} wants to join</span>
          <button type="button" className="play-btn" data-testid="peer-knock-let" onClick={() => letIn(k.knock)}>
            Let in
          </button>
          <button type="button" className="play-btn is-ghost" data-testid="peer-knock-away" onClick={() => turnAway(k.knock)}>
            Turn away
          </button>
        </div>
      ))}
    </div>
  );
}

let watching = false;

/** The door put over the page once, for a host's page: it shows itself when somebody knocks. */
export function watchKnocks(): void {
  if (watching || typeof document === 'undefined') return;
  watching = true;
  const at = document.createElement('div');
  document.body.appendChild(at);
  render(h(PeerKnocks, {}), at);
}
