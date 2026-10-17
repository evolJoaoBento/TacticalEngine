/**
 * A guest whose link to the host of a peer game dropped (`docs/PEER.md`), coming back in the same tab: the page plays
 * on alone meanwhile, and this says so over the game, with a code of the guest's own to send the host (`connect.ts`,
 * `ask`). The host pastes it and sends an answer back; pasted here, the channel opens and the wire, which has waited
 * for it, comes back to the game - stood where it is, the guest's seat still theirs. Nothing while the link is up.
 * A guest who joined by a room's link (`?room=`, `relay.ts`) is brought back through the room, by itself: the codes
 * are shown only when the room does not answer (`ROOM_TRIES`). A guest the host removed, or did not let back in, is
 * told so, and offered nothing: the host has said.
 */

import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ask, type Asked } from '../peer/connect';
import { meetAtRoom, onPeerLost, onPeerRemoved, peerLost, peerRemoved, peerSelf, rejoinedOver } from '../peer/peer-play';
import { roomOf } from '../peer/relay';

/** How many times a guest's page knocks at the room before it shows the codes instead. */
export const ROOM_TRIES = 3;

const REMOVED_SAID = 'The host removed you from the game. You play on alone.';
import { CopyButton } from './PeerInvites';

function PeerRejoin(): preact.JSX.Element | null {
  const [lost, setLost] = useState(peerLost());
  useEffect(() => onPeerLost(setLost), []);
  const [asked, setAsked] = useState<Asked | null>(null);
  const [answer, setAnswer] = useState('');
  const [said, setSaid] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [auto, setAuto] = useState(false);
  /** What the host said, when it was no: removed, or not let back in. */
  const [ended, setEnded] = useState<string | null>(peerRemoved() ? REMOVED_SAID : null);
  useEffect(() => onPeerRemoved(() => setEnded(REMOVED_SAID)), []);
  const write = (): void => {
    asked?.close();
    setSaid('');
    setAnswer('');
    setAsked(null);
    void ask(peerSelf()).then(setAsked, (failure: unknown) => setSaid(failure instanceof Error ? failure.message : String(failure)));
  };
  useEffect(() => {
    if (!lost) {
      setAsked(null);
      setSaid('');
      setAuto(false);
      return;
    }
    if (peerRemoved()) return;
    const room = roomOf();
    if (room === null) return write();
    // Through the room, by itself; the codes once it has not answered.
    let stopped = false;
    setAuto(true);
    void (async () => {
      for (let tried = 0; tried < ROOM_TRIES && !stopped; tried++) {
        const channel = await meetAtRoom(room);
        if (stopped) return;
        if (channel === 'refused') {
          setAuto(false);
          return setEnded('The host did not let you back in. You play on alone.');
        }
        if (channel !== null) return rejoinedOver(channel);
      }
      if (stopped) return;
      setAuto(false);
      write();
    })();
    return () => {
      stopped = true;
    };
  }, [lost]);
  if (ended !== null) {
    return (
      <div className="play-box peer-lost" role="dialog" aria-label="Not at the table" data-testid="peer-ended">
        <div className="play-eyebrow">Not at the table</div>
        <p className="panel-sub">{ended}</p>
      </div>
    );
  }
  if (!lost) return null;
  if (auto) {
    return (
      <div className="play-box peer-lost" role="dialog" aria-label="Lost the host" data-testid="peer-lost">
        <div className="play-eyebrow">Lost the host</div>
        <p className="panel-sub" data-testid="peer-lost-auto">
          Reconnecting to your host… You play on alone meanwhile.
        </p>
      </div>
    );
  }
  const connect = async (): Promise<void> => {
    if (asked === null) return;
    setConnecting(true);
    setSaid('Connecting…');
    try {
      rejoinedOver(await asked.accept(answer));
    } catch (failure) {
      setSaid(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setConnecting(false);
    }
  };
  return (
    <div className="play-box peer-lost" role="dialog" aria-label="Lost the host" data-testid="peer-lost">
      <div className="play-eyebrow">Lost the host</div>
      <div className="panel-sub">You play on alone until you are back. Send your host this code:</div>
      {asked === null ? (
        <p className="panel-sub">Writing your code…</p>
      ) : (
        <div className="panel-row" style={{ gap: '4px' }}>
          <textarea className="players-invite peer-code" rows={2} readOnly value={asked.code} data-testid="peer-lost-code" onFocus={(e) => e.currentTarget.select()} />
          <CopyButton text={asked.code} testid="peer-lost-copy" />
        </div>
      )}
      <div className="panel-sub">Paste the answer they send back:</div>
      <div className="panel-row" style={{ gap: '4px' }}>
        <textarea className="players-invite peer-code" rows={2} value={answer} data-testid="peer-lost-answer" onInput={(e) => setAnswer(e.currentTarget.value)} />
        <button type="button" className="play-btn" data-testid="peer-lost-connect" disabled={asked === null || connecting || answer.trim() === ''} onClick={() => void connect()}>
          Connect
        </button>
      </div>
      {said === '' ? null : (
        <p className="panel-sub" data-testid="peer-lost-said">
          {said}{' '}
          {connecting ? null : (
            <button type="button" className="play-btn is-ghost" data-testid="peer-lost-again" onClick={write}>
              Write a new code
            </button>
          )}
        </p>
      )}
    </div>
  );
}

let watching = false;

/** The panel put over the game once, for a guest's page: it shows itself when the link drops. */
export function watchRejoin(): void {
  if (watching || typeof document === 'undefined') return;
  watching = true;
  const at = document.createElement('div');
  document.body.appendChild(at);
  render(h(PeerRejoin, {}), at);
}
