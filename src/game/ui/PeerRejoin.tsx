/**
 * A guest whose link to the host of a peer game dropped (`docs/PEER.md`), coming back in the same tab: the page plays
 * on alone meanwhile, and this says so over the game, with a code of the guest's own to send the host (`connect.ts`,
 * `ask`). The host pastes it and sends an answer back; pasted here, the channel opens and the wire, which has waited
 * for it, comes back to the game - stood where it is, the guest's seat still theirs. Nothing while the link is up.
 */

import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ask, type Asked } from '../peer/connect';
import { onPeerLost, peerLost, peerSelf, rejoinedOver } from '../peer/peer-play';
import { CopyButton } from './PeerInvites';

function PeerRejoin(): preact.JSX.Element | null {
  const [lost, setLost] = useState(peerLost());
  useEffect(() => onPeerLost(setLost), []);
  const [asked, setAsked] = useState<Asked | null>(null);
  const [answer, setAnswer] = useState('');
  const [said, setSaid] = useState('');
  const [connecting, setConnecting] = useState(false);
  const write = (): void => {
    asked?.close();
    setSaid('');
    setAnswer('');
    setAsked(null);
    void ask(peerSelf()).then(setAsked, (failure: unknown) => setSaid(failure instanceof Error ? failure.message : String(failure)));
  };
  useEffect(() => {
    if (lost) write();
    else {
      setAsked(null);
      setSaid('');
    }
  }, [lost]);
  if (!lost) return null;
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
